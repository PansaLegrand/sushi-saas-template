import Stripe from "stripe";
import { handleCheckoutSession } from "@/services/stripe";
import { markReservationConfirmed, getServiceById } from "@/models/reservation";
import { buildReservationICS } from "@/services/reservations/ics";
import { buildGoogleCalendarUrl } from "@/services/reservations/google";
import { ReservationsConfig } from "@/config/reservations";
import { getPricingConfig } from "@/config/pricing";
import { absoluteLocaleUrl, locales } from "@/i18n/locale";
import { OrderStatus } from "@/models/order";
import { insertRenewalOrderWithGrant } from "@/models/fulfillment";
import { CreditsTransType } from "@/services/credit";
import {
  renewalOrderNo,
  subscriptionPeriodTransNo,
} from "@/services/stripe/idempotency";
import { extractWebhookReceipt } from "@/services/stripe/receipt";
import { updateAffiliateForOrder } from "@/services/affiliate";
import { syncStripeSubscription } from "@/services/subscriptions";
import { findPersonalOrganizationByUserUuid } from "@/models/organization";
import { getUserUuidsByEmail } from "@/models/user";
import { enqueueJob } from "@/services/jobs";
import { getAppEnv, getRequiredEnv, isProductionRuntime } from "@/lib/env";
import { newStripeClient } from "@/integrations/stripe";
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventActionRequired,
  markStripeWebhookEventCompleted,
  markStripeWebhookEventFailed,
} from "@/models/stripe-webhook-event";
import {
  ActionRequiredError,
  isActionRequired,
} from "@/services/stripe/action-required";
import { respCode } from "@/lib/errors/response";
import { logger } from "@/lib/logger/server";

const IDEMPOTENT_STRIPE_EVENTS = new Set([
  "checkout.session.completed",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  // Subscription state changes are claimed too. Redelivery of one of these is
  // harmless on its own — the upsert is idempotent — but claiming keeps the
  // processed-event table a complete record of what we acted on.
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded",
  "charge.dispute.created",
]);

// Stripe sends webhook events via POST requests with a signed payload.
// Configure Stripe CLI or dashboard to forward events to this endpoint:
//   stripe listen --forward-to localhost:3000/api/pay/webhook/stripe
// Then trigger a test event:
//   stripe trigger checkout_session_completed

export async function POST(req: Request) {
  // Hoisted so the catch-all below can name the event it died on. `event` is
  // scoped to the try block, and a 500 with no event id is unactionable: you
  // cannot find it in the Stripe dashboard to replay it.
  let stripeEventId: string | undefined;
  let stripeEventType: string | undefined;

  try {
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return respCode("PAYMENT_WEBHOOK_INVALID_SIGNATURE");
    }

    const secret = getRequiredEnv("STRIPE_WEBHOOK_SECRET");

    const rawBody = await req.text();

    let event: Stripe.Event;
    try {
      // Verify using static helper; no API key needed.
      event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      logger.warn(
        { err, event: "pay.webhook_invalid_signature" },
        "invalid stripe signature"
      );
      return respCode("PAYMENT_WEBHOOK_INVALID_SIGNATURE");
    }

    stripeEventId = event.id;
    stripeEventType = event.type;

    // A test-mode event reaching production means the deployment is holding a
    // test-mode webhook secret — the signature above verified, so this is a
    // misconfiguration rather than a forgery. Reject before claiming the event
    // or granting anything: test-mode ids resolve against no real customer, and
    // `stripe trigger` sends whatever amounts the fixture happens to carry.
    //
    // 400, not 500: Stripe stops retrying a 4xx and surfaces the failure on the
    // endpoint in the dashboard, which is where the operator has to go to fix
    // it anyway. A 500 would retry for three days and hide the cause.
    //
    // Deliberately not a catalog code — Stripe is the only reader of this body,
    // and the catalog demands five locale translations for a string no person
    // will see. Matches the plain 500 the catch-all below returns.
    // `!== true` rather than `=== false`: fail closed. Stripe always sets the
    // field, so nothing legitimate is rejected, and a hand-rolled payload
    // missing it should not be the one shape that slips past.
    if (isProductionRuntime() && event.livemode !== true) {
      logger.error(
        {
          event: "pay.webhook_test_mode_rejected",
          stripe_event_id: event.id,
          stripe_event_type: event.type,
        },
        "rejected a test-mode stripe event in production"
      );
      return new Response("test-mode event rejected", { status: 400 });
    }

    let claimedEvent = false;
    if (IDEMPOTENT_STRIPE_EVENTS.has(event.type)) {
      const claimStatus = await claimStripeWebhookEvent({
        eventId: event.id,
        eventType: event.type,
        payload: rawBody,
        // Flattened here rather than inside the model, so the ids are queryable
        // without parsing the payload back out of a `text` column.
        receipt: extractWebhookReceipt(event),
      });

      if (claimStatus === "completed") {
        return new Response("ok", { status: 200 });
      }

      if (claimStatus === "processing") {
        return new Response("event already processing", { status: 409 });
      }

      claimedEvent = true;
    }

    try {
      switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const stripe = newStripeClient().stripe();
        await handleCheckoutSession(stripe, session);

        // Entitle the user now rather than when `customer.subscription.created`
        // happens to arrive. The two events are not ordered, and the one the
        // user is waiting on is this one: they have just been redirected back
        // from Checkout and expect the feature they paid for to be there.
        // Applying both is safe — the upsert keeps whichever event is newer.
        if (session.mode === "subscription" && session.subscription) {
          const subscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;

          try {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            await syncStripeSubscription(subscription, new Date(event.created * 1000));
          } catch (e) {
            // Non-fatal: `customer.subscription.created` still carries the same
            // object, so a failure here costs latency, not entitlement.
            //
            // The sync's own `unmapped` result is deliberately ignored here for
            // the same reason. It is raised as `action_required` from the
            // dedicated subscription case, where it is the whole point of the
            // event rather than an optimization on top of a completed checkout.
            logger.warn(
              {
                err: e,
                event: "pay.webhook_subscription_sync_failed",
                stripe_event_id: event.id,
                subscription_id: subscriptionId,
              },
              "failed to sync subscription from checkout session"
            );
          }
        }
        // If this checkout was for a reservation, confirm it now
        if (ReservationsConfig.enabled && session.metadata?.type === "reservation") {
          const reservationNo = session.metadata?.reservation_no;
          if (reservationNo) {
            try {
              const confirmed = await markReservationConfirmed(reservationNo);
              const to = session.customer_details?.email;
              if (to && confirmed) {
                const svc = await getServiceById(confirmed.service_id);
                const start = new Date(confirmed.start_at as any);
                const end = new Date(confirmed.end_at as any);
                const ics = buildReservationICS({
                  uid: reservationNo,
                  start,
                  end,
                  title: `Reservation: ${svc?.title ?? "Service"}`,
                  description: `Reservation #${reservationNo} — ${svc?.title ?? "Service"}`,
                  url: absoluteLocaleUrl(
                    getAppEnv().NEXT_PUBLIC_WEB_URL,
                    "en",
                    `/reserve?reservation_no=${reservationNo}`
                  ),
                });
                const googleUrl = buildGoogleCalendarUrl({
                  title: `Reservation: ${svc?.title ?? "Service"}`,
                  start,
                  end,
                  description: `Reservation #${reservationNo}`,
                  timeZone: ReservationsConfig.baseTimeZone,
                });
                await enqueueJob(
                  "reservation_confirmed_email",
                  {
                    to,
                    reservationNo,
                    serviceTitle: svc?.title ?? undefined,
                    startsAt: start.toISOString(),
                    timezone: confirmed.timezone ?? undefined,
                    icsContent: ics,
                    googleCalendarUrl: googleUrl,
                  },
                  {
                    dedupeKey: `reservation_confirmed_email:${reservationNo}`,
                  }
                );
              }
            } catch (e) {
              logger.error(
                {
                  err: e,
                  event: "pay.webhook_reservation_confirm_failed",
                  stripe_event_id: event.id,
                  reservation_no: reservationNo,
                },
                "failed to confirm reservation"
              );
            }
          }
        }
        // Send a confirmation email in the background; do not block webhook ack
        const to = session.customer_details?.email;
        if (to) {
          const orderNo = session.metadata?.order_no || session.id;
          const amount = typeof session.amount_total === "number" && session.amount_total != null
            ? session.amount_total / 100
            : undefined;
          const currency = session.currency ?? undefined;
          await enqueueJob(
            "payment_success_email",
            { to, orderNo, amount, currency },
            { dedupeKey: `payment_success_email:${event.id}:${orderNo}` }
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
            { dedupeKey: `slack_event:${event.id}:payment_succeeded` }
          );
        }
        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        // Avoid double-provisioning on initial subscription creation; handle only recurring cycles
        if (invoice.billing_reason && invoice.billing_reason !== "subscription_cycle") {
          break;
        }

        const stripe = newStripeClient().stripe();

        // Everything below that cannot be resolved raises `ActionRequiredError`
        // rather than `break`ing. A bare `break` here fell through to
        // `markStripeWebhookEventCompleted` — so an invoice this app could not
        // provision was recorded as successfully handled, and the customer's
        // money sat in Stripe with nothing to show for it and no alert.
        const subId = (invoice.subscription as string) || "";
        if (!subId) {
          throw new ActionRequiredError("renewal_invoice_without_subscription", {
            stripe_invoice_id: invoice.id,
          });
        }

        // Period boundaries from the first subscription line
        const line = invoice.lines?.data?.find((l) => (l as any).type !== "invoiceitem") || invoice.lines?.data?.[0];
        const periodStart = line?.period?.start ?? undefined;
        const periodEnd = line?.period?.end ?? undefined;
        const priceId = line?.price?.id ?? undefined;
        const interval = line?.price?.recurring?.interval ?? undefined;

        // No "have we seen this cycle?" pre-check. The order number below is
        // derived from the billing period, so a replay conflicts on
        // `orders.order_no` and the grant conflicts on `credits.trans_no`. The
        // pre-check that used to live here skipped the grant whenever the order
        // existed — which meant a cycle whose order was written but whose
        // credits were not could never be repaired.
        if (!periodStart) {
          throw new ActionRequiredError("renewal_invoice_without_period", {
            stripe_invoice_id: invoice.id,
            stripe_subscription_id: subId,
          });
        }

        // Resolve the plan from configured price IDs
        function findPlanByPriceId(id?: string) {
          if (!id) return undefined;
          // Search across locales (price IDs should be the same per currency)
          for (const loc of locales) {
            const cfg = getPricingConfig(loc);
            const item = cfg.items?.find((it: any) => it?.price_id === id || it?.cn_price_id === id);
            if (item) return item as any;
          }
          // Fallback: try default locale
          const en = getPricingConfig("en");
          return en.items?.find((it: any) => it?.price_id === id || it?.cn_price_id === id) as any;
        }

        const plan = findPlanByPriceId(priceId);

        // The case this status exists for, and it was not a `break` — it was
        // worse. `plan` was resolved and never checked, so `credits` fell back to
        // `?? 0` further down: an unmapped price recorded a *paid order granting
        // nothing*, product name taken from the Stripe nickname so it looked
        // plausible, and marked the event completed. The customer paid, received
        // no credits, and nothing anywhere said so.
        //
        // Not retriable: the price is missing from `src/config/pricing.ts` and
        // three days of Stripe retries will not add it. Someone has to either map
        // the price or refund the invoice.
        if (!plan) {
          throw new ActionRequiredError("unmapped_price", {
            stripe_price_id: priceId,
            stripe_invoice_id: invoice.id,
            stripe_subscription_id: subId,
          });
        }

        // Resolve user identity
        let userUuid = (invoice as any).metadata?.user_uuid as string | undefined;
        let userEmail = invoice.customer_email || (invoice as any).customer_email || undefined;
        // Try subscription metadata for uuid/email if missing
        if (!userUuid || !userEmail) {
          try {
            const sub = await stripe.subscriptions.retrieve(subId, { expand: ["customer"] as any });
            userUuid = (sub as any).metadata?.user_uuid ?? userUuid;
            userEmail = (sub as any).metadata?.user_email ?? userEmail;
            if (!userEmail && (sub.customer as any)?.email) {
              userEmail = (sub.customer as any).email;
            }
          } catch (e) {
            // continue with whatever we have
          }
        }

        // Fallback: resolve uuid by email from DB
        if (!userUuid && userEmail) {
          const userUuids = await getUserUuidsByEmail(userEmail);
          userUuid = userUuids?.length === 1 ? userUuids[0] : undefined;
        }
        // Cannot provision without a user. Every resolution path above has been
        // tried — invoice metadata, subscription metadata, the customer's email,
        // then a unique email match — so this is a payment that cannot be
        // attributed to anyone, which is a person's problem and not a retry's.
        if (!userUuid) {
          throw new ActionRequiredError("renewal_user_unresolved", {
            stripe_invoice_id: invoice.id,
            stripe_subscription_id: subId,
            stripe_customer_email: userEmail,
          });
        }

        // Credits pool at the organization. Metadata set by our checkout wins;
        // otherwise fall back to the payer's personal workspace, which is
        // correct for any account that never created a second org.
        const orgUuid =
          ((invoice as any).metadata?.org_uuid as string | undefined) ||
          (await findPersonalOrganizationByUserUuid(userUuid))?.uuid;

        // Cannot provision without a tenant. A user with no personal
        // organization means the signup backfill did not run for them, which is a
        // data repair rather than a transient fault.
        if (!orgUuid) {
          throw new ActionRequiredError("renewal_org_unresolved", {
            stripe_invoice_id: invoice.id,
            stripe_subscription_id: subId,
            user_id: userUuid,
          });
        }

        // Compute expiry: use period end + 24h grace similar to checkout route
        const graceMs = 24 * 60 * 60 * 1000;
        const expiredAt = periodEnd ? new Date(periodEnd * 1000 + graceMs) : null;

        const amount = typeof invoice.amount_paid === "number" ? invoice.amount_paid : 0;
        const currency = (invoice.currency || "usd") as string;
        const product_name = (plan?.product_name as string | undefined) ?? line?.price?.nickname ?? "Subscription";
        const product_id = (plan?.product_id as string | undefined) ?? priceId ?? "subscription";
        const credits = (plan?.credits as number | undefined) ?? 0;

        // Derived from the billing period, so the insert below is idempotent
        // under the existing unique index on `orders.order_no`.
        const order_no = renewalOrderNo(subId, periodStart);

        // The renewal order and its credits, in one transaction. The grant is
        // attempted whether or not the order was new, so a cycle previously
        // recorded without its credits is repaired by the next delivery.
        const { order, order_created, credit_granted } =
          await insertRenewalOrderWithGrant({
            order: {
              order_no,
              created_at: new Date(),
              org_uuid: orgUuid,
              user_uuid: userUuid,
              user_email: userEmail || "",
              amount,
              interval: (interval as string) || "month",
              expired_at: expiredAt,
              status: OrderStatus.Paid,
              credits,
              currency,
              product_id,
              product_name,
              valid_months: plan?.valid_months ?? (interval === "year" ? 12 : 1),
              sub_id: subId,
              sub_interval_count: line?.quantity ?? 1,
              sub_cycle_anchor: undefined,
              sub_period_end: periodEnd ?? undefined,
              sub_period_start: periodStart,
              sub_times: undefined,
              paid_at: new Date(),
              paid_email: userEmail || undefined,
              paid_detail: JSON.stringify({ invoiceId: invoice.id }),
            },
            grant:
              credits && credits > 0
                ? {
                    trans_no: subscriptionPeriodTransNo(subId, periodStart),
                    trans_type: CreditsTransType.OrderPay,
                    credits,
                    expired_at: expiredAt,
                    actor: "stripe:webhook",
                    metadata_json: JSON.stringify({
                      stripe_event_id: event.id,
                      stripe_invoice_id: invoice.id,
                      stripe_subscription_id: subId,
                    }),
                  }
                : null,
          });

        logger.info(
          {
            event: "pay.renewal_fulfilled",
            stripe_event_id: event.id,
            order_no,
            org_id: orgUuid,
            user_id: userUuid,
            credits,
            order_created,
            credit_granted,
          },
          "subscription renewal fulfilled"
        );

        // Everything below is a side effect that must fire once per cycle, not
        // once per delivery. `order_created` is the cycle's own first-time flag;
        // the job dedupe keys are scoped to an event id, which would let a
        // second event for the same period notify twice.
        if (!order_created) break;

        // Affiliate reward for renewal orders (optional; follows current model)
        if (order) await updateAffiliateForOrder(order as any);
        await enqueueJob(
          "slack_event",
          {
            title: "Subscription renewal succeeded",
            context: {
              order_no,
              user_uuid: userUuid,
              email: userEmail,
              amount: amount / 100,
              currency,
              product_id,
              interval,
            },
          },
          { dedupeKey: `slack_event:${event.id}:subscription_renewal` }
        );
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.customer_email) {
          const amountDue = typeof invoice.amount_due === "number" ? invoice.amount_due / 100 : undefined;
          const manageUrlBase = getAppEnv().NEXT_PUBLIC_WEB_URL;
          const manageUrl = absoluteLocaleUrl(manageUrlBase, "en", "/account/billing");
          await enqueueJob(
            "payment_failed_email",
            {
              to: invoice.customer_email,
              invoiceNumber: invoice.number || invoice.id,
              amount: amountDue,
              currency: invoice.currency || undefined,
              manageUrl,
            },
            { dedupeKey: `payment_failed_email:${event.id}` }
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
            { dedupeKey: `slack_error:${event.id}:payment_failed` }
          );
        }
        break;
      }
      // The subscription lifecycle. One handler for all three events, because
      // Stripe sends the full subscription object with each of them and we
      // copy it wholesale rather than computing transitions ourselves — a
      // cancellation is just an object whose status is now "canceled".
      //
      // This is what makes cancelling, downgrading, pausing, and a card
      // failing all reach the database. Without it, a user who cancels in the
      // billing portal keeps their tier until their order row expires, which
      // is to say: for the rest of the period they already paid for, and then
      // silently forever if the order had no expiry.
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const synced = await syncStripeSubscription(
          subscription,
          new Date(event.created * 1000)
        );

        // `syncStripeSubscription` already classifies its own failures and
        // returns them, so the policy decision — which classifications a human
        // has to resolve — is made here, next to the statuses it writes, rather
        // than pushed down into the service.
        //
        // All three `unmapped` reasons are configuration or data problems: a
        // price missing from the catalog, a Stripe customer with no local user, a
        // user with no organization. Previously each of these logged an error and
        // let the event complete, so an entitlement that never applied looked
        // exactly like one that did.
        if (synced.status === "unmapped") {
          throw new ActionRequiredError(`subscription_${synced.reason}`, {
            stripe_subscription_id: subscription.id,
            stripe_customer_id:
              typeof subscription.customer === "string"
                ? subscription.customer
                : subscription.customer?.id,
          });
        }
        break;
      }

      // Money coming back out. Neither is auto-reversed, but not for the reason
      // it looks like: Stripe has no customer-initiated refund, so a
      // `charge.refunded` means someone with dashboard access already approved
      // it. Consent is not what is missing.
      //
      // What is missing is a defensible amount. A partial refund is not a full
      // revocation, the credits may already be spent — making the reversal
      // arithmetically impossible rather than merely unwise — and a dispute is
      // the one case with no approval at all: the customer went to their bank,
      // the funds are already debited, and the dispute may still be won, so
      // clawing back a tier mid-dispute can be wrong in both directions.
      //
      // So this raises the alert and leaves the call to a human. What it must
      // not do is stay silent, which is what happens when the event is not
      // handled at all.
      //
      // Planned successor, decided rather than pending: an `action_required` row
      // carrying the computed shortfall, which a reconciliation script can find
      // — a Slack message is something someone scrolls past. Credits are still
      // never reversed automatically. See "Refund handling" under item 5 in
      // roadmap.md for the full spec.
      case "charge.refunded":
      case "charge.dispute.created": {
        const charge = event.data.object as Stripe.Charge | Stripe.Dispute;
        await enqueueJob(
          "slack_error",
          {
            title:
              event.type === "charge.refunded"
                ? "Charge refunded — review credits and access"
                : "Chargeback opened — review credits and access",
            context: {
              event_type: event.type,
              charge_id: "charge" in charge ? String(charge.charge) : charge.id,
              amount:
                typeof charge.amount === "number" ? charge.amount / 100 : undefined,
              currency: charge.currency,
            },
          },
          { dedupeKey: `slack_error:${event.id}:${event.type}` }
        );
        break;
      }

      default:
        // Ignore other event types for now.
        break;
      }

      if (claimedEvent) {
        await markStripeWebhookEventCompleted(event.id);
      }
    } catch (error) {
      // An event that needs a human is not a failure to retry. Park it and
      // answer 200, which is what stops Stripe's three days of retries — the
      // condition will not have changed by the last one. Recovery is a person
      // fixing the cause and replaying, or step 4's reconciliation sweep.
      if (isActionRequired(error)) {
        if (claimedEvent) {
          await markStripeWebhookEventActionRequired(event.id, error.describe());
        }

        logger.error(
          {
            event: "pay.webhook_action_required",
            stripe_event_id: event.id,
            stripe_event_type: event.type,
            reason: error.reason,
            ...error.detail,
          },
          "stripe webhook needs manual action"
        );

        return new Response("action required", { status: 200 });
      }

      if (claimedEvent) {
        await markStripeWebhookEventFailed(event.id, error);
      }
      throw error;
    }

    return new Response("ok", { status: 200 });
  } catch (error) {
    logger.error(
      {
        err: error,
        event: "pay.webhook_failed",
        stripe_event_id: stripeEventId,
        stripe_event_type: stripeEventType,
      },
      "stripe webhook failed"
    );
    return new Response("webhook error", { status: 500 });
  }
}
