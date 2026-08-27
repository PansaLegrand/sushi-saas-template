import type Stripe from "stripe";

import { absoluteLocaleUrl } from "@/i18n/locale";
import { newStripeClient } from "@/integrations/stripe";
import { getAppEnv } from "@/lib/env";
import { logger } from "@/lib/logger/server";
import { enqueueJob } from "@/services/jobs";
import {
  expireReservationCheckoutSession,
  fulfillReservationCheckoutSession,
} from "@/services/reservations";
import { handleCheckoutSession } from "@/services/stripe";
import { syncStripeSubscription } from "@/services/subscriptions";

/** Fulfill a paid Checkout Session and queue its non-critical notifications. */
export async function handlePaidCheckoutEvent(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const stripe = newStripeClient().stripe();

  // Some delayed payment methods complete Checkout before money settles. A
  // reservation is not confirmed—and a normal order is not fulfilled—until
  // Stripe says the session is actually paid.
  if (session.payment_status === "unpaid") {
    logger.info(
      {
        event: "pay.webhook_checkout_awaiting_payment",
        stripe_event_id: event.id,
        stripe_session_id: session.id,
      },
      "checkout completed before payment settled",
    );
    return;
  }

  if (session.metadata?.type === "reservation") {
    // Feature flags stop new sales; they must never stop fulfillment for money
    // already accepted while the feature was enabled.
    await fulfillReservationCheckoutSession(session);
  } else {
    await handleCheckoutSession(stripe, session);
  }

  await syncCheckoutSubscription(event, session, stripe);
  await enqueueCheckoutNotifications(event, session);
}

/** Release a reservation hold from a terminal unpaid Checkout event. */
export async function handleExpiredCheckoutEvent(
  event: Stripe.Event,
): Promise<void> {
  await expireReservationCheckoutSession(
    event.data.object as Stripe.Checkout.Session,
  );
}

/** Queue the customer and operator notifications for a failed invoice. */
export async function handleFailedInvoiceEvent(
  event: Stripe.Event,
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  if (!invoice.customer_email) return;

  const amountDue =
    typeof invoice.amount_due === "number"
      ? invoice.amount_due / 100
      : undefined;
  const manageUrl = absoluteLocaleUrl(
    getAppEnv().NEXT_PUBLIC_WEB_URL,
    "en",
    "/account/billing",
  );

  await enqueueJob(
    "payment_failed_email",
    {
      to: invoice.customer_email,
      invoiceNumber: invoice.number || invoice.id,
      amount: amountDue,
      currency: invoice.currency || undefined,
      manageUrl,
    },
    { dedupeKey: `payment_failed_email:${event.id}` },
  );
  await enqueueJob(
    "slack_error",
    {
      title: "Payment failed",
      context: {
        invoice_id: invoice.id,
        email: invoice.customer_email,
        amount_due: amountDue,
        currency: invoice.currency || undefined,
      },
    },
    { dedupeKey: `slack_error:${event.id}:payment_failed` },
  );
}

async function syncCheckoutSubscription(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  stripe: Stripe,
): Promise<void> {
  // Entitle the user now rather than when customer.subscription.created happens
  // to arrive. The events are unordered, and applying both is safe because the
  // subscription upsert keeps whichever event is newer.
  if (session.mode !== "subscription" || !session.subscription) return;

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id;

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await syncStripeSubscription(subscription, new Date(event.created * 1000));
  } catch (error) {
    // Non-fatal: the dedicated subscription event still carries the same state,
    // so a failure here costs latency rather than losing the entitlement.
    logger.warn(
      {
        err: error,
        event: "pay.webhook_subscription_sync_failed",
        stripe_event_id: event.id,
        subscription_id: subscriptionId,
      },
      "failed to sync subscription from checkout session",
    );
  }
}

async function enqueueCheckoutNotifications(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const to = session.customer_details?.email;
  if (!to) return;

  const orderNo = session.metadata?.order_no || session.id;
  const amount =
    typeof session.amount_total === "number"
      ? session.amount_total / 100
      : undefined;
  const currency = session.currency ?? undefined;

  await enqueueJob(
    "payment_success_email",
    { to, orderNo, amount, currency },
    { dedupeKey: `payment_success_email:${event.id}:${orderNo}` },
  );
  await enqueueJob(
    "slack_event",
    {
      title: "Payment succeeded",
      context: {
        order_no: orderNo,
        email: to,
        amount,
        currency,
        type: session.mode,
      },
    },
    { dedupeKey: `slack_event:${event.id}:payment_succeeded` },
  );
}
