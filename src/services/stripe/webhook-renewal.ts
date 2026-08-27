import type Stripe from "stripe";

import { newStripeClient } from "@/integrations/stripe";
import { insertRenewalOrderWithGrant } from "@/models/fulfillment";
import {
  findOrganizationByStripeCustomerId,
  findPersonalOrganizationByUserUuid,
} from "@/models/organization";
import { OrderStatus } from "@/models/order";
import { findSubscriptionByStripeId } from "@/models/subscription";
import { findUserByStripeCustomerId, getUserUuidsByEmail } from "@/models/user";
import { updateAffiliateForOrder } from "@/services/affiliate";
import { findBillingProductByPriceId } from "@/services/billing-catalog";
import { CreditsTransType } from "@/services/credit";
import { enqueueJob } from "@/services/jobs";
import { logger } from "@/lib/logger/server";

import { ActionRequiredError } from "./action-required";
import { renewalOrderNo, subscriptionPeriodTransNo } from "./idempotency";

type RenewalSubject = {
  userUuid: string;
  orgUuid: string;
  userEmail?: string;
};

/** Record one subscription billing period and its credit grant atomically. */
export async function handleRenewalInvoiceEvent(
  event: Stripe.Event,
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  // Checkout owns the initial grant. Every other non-cycle reason can reflect
  // a plan, quantity, proration, or manual mutation and is unsafe to translate
  // into fixed catalog credits.
  if (invoice.billing_reason === "subscription_create") return;
  if (
    invoice.billing_reason &&
    invoice.billing_reason !== "subscription_cycle"
  ) {
    throw new ActionRequiredError("renewal_unsupported_billing_reason", {
      stripe_invoice_id: invoice.id,
      billing_reason: invoice.billing_reason,
    });
  }

  const subscriptionId = stripeObjectId(invoice.subscription);
  if (!subscriptionId) {
    throw new ActionRequiredError("renewal_invoice_without_subscription", {
      stripe_invoice_id: invoice.id,
    });
  }

  const subscriptionLines = (invoice.lines?.data ?? []).filter(
    (candidate) => candidate.type !== "invoiceitem",
  );
  if (subscriptionLines.length !== 1) {
    throw new ActionRequiredError("renewal_ambiguous_subscription_lines", {
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId,
      line_count: subscriptionLines.length,
    });
  }

  const line = subscriptionLines[0];
  const periodStart = line.period?.start;
  const periodEnd = line.period?.end;
  const priceId = line.price?.id;
  const interval = line.price?.recurring?.interval;
  const quantity = line.quantity ?? 1;

  if (quantity !== 1) {
    throw new ActionRequiredError("renewal_unsupported_quantity", {
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId,
      stripe_price_id: priceId,
      quantity,
    });
  }
  if (!periodStart) {
    throw new ActionRequiredError("renewal_invoice_without_period", {
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId,
    });
  }

  const catalogEntry = findBillingProductByPriceId(priceId);
  if (!catalogEntry) {
    throw new ActionRequiredError("unmapped_price", {
      stripe_price_id: priceId,
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId,
    });
  }

  const stripe = newStripeClient().stripe();
  const subject = await resolveRenewalSubject({
    invoice,
    stripe,
    subscriptionId,
  });
  const fulfilledAt = new Date();
  const expiredAt = periodEnd
    ? new Date(periodEnd * 1000 + 24 * 60 * 60 * 1000)
    : null;
  const { product } = catalogEntry;
  const orderNo = renewalOrderNo(subscriptionId, periodStart);

  // No preflight "have we seen this cycle?" check. The deterministic order and
  // transaction numbers make both writes replay-safe, while still allowing a
  // previously missing grant to be repaired by the next delivery.
  const { order, order_created, credit_granted } =
    await insertRenewalOrderWithGrant({
      order: {
        order_no: orderNo,
        created_at: fulfilledAt,
        org_uuid: subject.orgUuid,
        user_uuid: subject.userUuid,
        user_email: subject.userEmail || "",
        amount: invoice.amount_paid,
        interval: interval || "month",
        expired_at: expiredAt,
        status: OrderStatus.Paid,
        credits: product.credits,
        currency: invoice.currency || "usd",
        product_id: product.id,
        product_name: product.name,
        valid_months: product.validMonths,
        sub_id: subscriptionId,
        sub_interval_count: quantity,
        sub_cycle_anchor: undefined,
        sub_period_end: periodEnd,
        sub_period_start: periodStart,
        sub_times: undefined,
        paid_at: fulfilledAt,
        paid_email: subject.userEmail,
        paid_detail: JSON.stringify({ invoiceId: invoice.id }),
      },
      grant:
        product.credits > 0
          ? {
              trans_no: subscriptionPeriodTransNo(subscriptionId, periodStart),
              trans_type: CreditsTransType.OrderPay,
              credits: product.credits,
              expired_at: expiredAt,
              actor: "stripe:webhook",
              metadata_json: JSON.stringify({
                stripe_event_id: event.id,
                stripe_invoice_id: invoice.id,
                stripe_subscription_id: subscriptionId,
              }),
            }
          : null,
    });

  logger.info(
    {
      event: "pay.renewal_fulfilled",
      stripe_event_id: event.id,
      order_no: orderNo,
      org_id: subject.orgUuid,
      user_id: subject.userUuid,
      credits: product.credits,
      order_created,
      credit_granted,
    },
    "subscription renewal fulfilled",
  );

  // These side effects fire once per billing cycle, not once per delivery.
  if (!order_created) return;

  if (order) await updateAffiliateForOrder(order);
  await enqueueJob(
    "slack_event",
    {
      title: "Subscription renewal succeeded",
      context: {
        order_no: orderNo,
        user_uuid: subject.userUuid,
        email: subject.userEmail,
        amount: invoice.amount_paid / 100,
        currency: invoice.currency || "usd",
        product_id: product.id,
        interval,
      },
    },
    { dedupeKey: `slack_event:${event.id}:subscription_renewal` },
  );
}

async function resolveRenewalSubject(input: {
  invoice: Stripe.Invoice;
  stripe: Stripe;
  subscriptionId: string;
}): Promise<RenewalSubject> {
  const { invoice, stripe, subscriptionId } = input;
  const localSubscription = await findSubscriptionByStripeId(subscriptionId);
  let stripeSubscription: Stripe.Subscription | undefined;
  let userUuid =
    localSubscription?.user_uuid || invoice.metadata?.user_uuid || undefined;
  let orgUuid =
    localSubscription?.org_uuid || invoice.metadata?.org_uuid || undefined;
  let userEmail = invoice.customer_email || undefined;

  // Subscription metadata is stamped by our Checkout request and is the next
  // authoritative tenant source. Retrieve whenever local state is incomplete.
  if (!userUuid || !orgUuid || !userEmail) {
    try {
      stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["customer"],
      });
      userUuid ||= stripeSubscription.metadata?.user_uuid || undefined;
      orgUuid ||= stripeSubscription.metadata?.org_uuid || undefined;
      userEmail ||= stripeSubscription.metadata?.user_email || undefined;

      if (
        !userEmail &&
        typeof stripeSubscription.customer !== "string" &&
        !stripeSubscription.customer.deleted
      ) {
        userEmail = stripeSubscription.customer.email || undefined;
      }
    } catch (error) {
      logger.warn(
        {
          err: error,
          event: "pay.renewal_subscription_retrieve_failed",
          stripe_invoice_id: invoice.id,
          stripe_subscription_id: subscriptionId,
        },
        "failed to retrieve subscription while attributing renewal",
      );
    }
  }

  if (!userUuid && userEmail) {
    const userUuids = await getUserUuidsByEmail(userEmail);
    userUuid = userUuids?.length === 1 ? userUuids[0] : undefined;
  }
  if (!userUuid) {
    throw new ActionRequiredError("renewal_user_unresolved", {
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId,
      stripe_customer_email: userEmail,
    });
  }

  const customerId =
    stripeObjectId(invoice.customer) ||
    stripeObjectId(stripeSubscription?.customer);
  if (!orgUuid && customerId) {
    orgUuid = (await findOrganizationByStripeCustomerId(customerId))?.uuid;
  }
  if (!orgUuid && customerId) {
    const legacyUser = await findUserByStripeCustomerId(customerId);
    if (legacyUser?.uuid === userUuid) {
      orgUuid = (await findPersonalOrganizationByUserUuid(userUuid))?.uuid;
    }
  }
  if (!orgUuid) {
    throw new ActionRequiredError("renewal_org_unresolved", {
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: subscriptionId,
      user_id: userUuid,
    });
  }

  return { userUuid, orgUuid, userEmail };
}

function stripeObjectId(
  value: string | { id: string } | null | undefined,
): string | undefined {
  return typeof value === "string" ? value : value?.id;
}
