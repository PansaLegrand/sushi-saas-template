import Stripe from "stripe";
import { handleCheckoutSession } from "@/services/stripe";
import { markReservationConfirmed, getServiceById } from "@/features/reservations/models";
import { buildReservationICS } from "@/features/reservations/ics";
import { buildGoogleCalendarUrl } from "@/features/reservations/google";
import { ReservationsConfig } from "@/features/reservations/config";
import { getPricingConfig } from "@/config/pricing";
import { locales } from "@/i18n/locale";
import { getSnowId } from "@/lib/hash";
import { insertOrder, OrderStatus, findOrderBySubscriptionPeriod } from "@/models/order";
import { increaseCredits, CreditsTransType } from "@/services/credit";
import { updateAffiliateForOrder } from "@/services/affiliate";
import { getUserUuidsByEmail } from "@/models/user";
import { enqueueJob } from "@/services/jobs";
import { getAppEnv, getRequiredEnv } from "@/lib/env";
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventCompleted,
  markStripeWebhookEventFailed,
} from "@/models/stripe-webhook-event";

const IDEMPOTENT_STRIPE_EVENTS = new Set([
  "checkout.session.completed",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);

// Stripe sends webhook events via POST requests with a signed payload.
// Configure Stripe CLI or dashboard to forward events to this endpoint:
//   stripe listen --forward-to localhost:3000/api/pay/webhook/stripe
// Then trigger a test event:
//   stripe trigger checkout_session_completed

export async function POST(req: Request) {
  try {
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return new Response("missing signature", { status: 400 });
    }

    const secret = getRequiredEnv("STRIPE_WEBHOOK_SECRET");

    const rawBody = await req.text();

    let event: Stripe.Event;
    try {
      // Verify using static helper; no API key needed.
      event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      console.warn("invalid stripe signature", err);
      return new Response("invalid signature", { status: 400 });
    }

    let claimedEvent = false;
    if (IDEMPOTENT_STRIPE_EVENTS.has(event.type)) {
      const claimStatus = await claimStripeWebhookEvent({
        eventId: event.id,
        eventType: event.type,
        payload: rawBody,
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
        const stripe = new Stripe(getRequiredEnv("STRIPE_PRIVATE_KEY"));
        await handleCheckoutSession(stripe, session);
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
                  url: `${getAppEnv().NEXT_PUBLIC_WEB_URL}/en/reserve?reservation_no=${reservationNo}`,
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
              console.error("failed to confirm reservation", e);
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

        const stripe = new Stripe(getRequiredEnv("STRIPE_PRIVATE_KEY"));

        const subId = (invoice.subscription as string) || "";
        if (!subId) break;

        // Period boundaries from the first subscription line
        const line = invoice.lines?.data?.find((l) => (l as any).type !== "invoiceitem") || invoice.lines?.data?.[0];
        const periodStart = line?.period?.start ?? undefined;
        const periodEnd = line?.period?.end ?? undefined;
        const priceId = line?.price?.id ?? undefined;
        const interval = line?.price?.recurring?.interval ?? undefined;

        if (periodStart && (await findOrderBySubscriptionPeriod(subId, periodStart))) {
          // Idempotency: we already created an order for this cycle
          break;
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
        if (!userUuid) break; // cannot provision without user

        // Compute expiry: use period end + 24h grace similar to checkout route
        const graceMs = 24 * 60 * 60 * 1000;
        const expiredAt = periodEnd ? new Date(periodEnd * 1000 + graceMs) : null;

        const amount = typeof invoice.amount_paid === "number" ? invoice.amount_paid : 0;
        const currency = (invoice.currency || "usd") as string;
        const product_name = (plan?.product_name as string | undefined) ?? line?.price?.nickname ?? "Subscription";
        const product_id = (plan?.product_id as string | undefined) ?? priceId ?? "subscription";
        const credits = (plan?.credits as number | undefined) ?? 0;

        const order_no = getSnowId();
        const order = await insertOrder({
          order_no,
          created_at: new Date(),
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
          sub_period_start: periodStart ?? undefined,
          sub_times: undefined,
          paid_at: new Date(),
          paid_email: userEmail || undefined,
          paid_detail: JSON.stringify({ invoiceId: invoice.id }),
        } as any);

        if (credits && credits > 0) {
          await increaseCredits({
            user_uuid: userUuid,
            trans_type: CreditsTransType.OrderPay,
            credits,
            expired_at: expiredAt ?? undefined,
            order_no: order_no,
          });
        }

        // Affiliate reward for renewal orders (optional; follows current model)
        await updateAffiliateForOrder(order as any);
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
          const manageUrl = `${manageUrlBase}/en/account/billing`;
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
      // You can extend handling for renewals:
      // case "invoice.payment_succeeded": {
      //   const invoice = event.data.object as Stripe.Invoice;
      //   // Map subscription renewals to your order/credit logic if desired.
      //   break;
      // }
      default:
        // Ignore other event types for now.
        break;
      }

      if (claimedEvent) {
        await markStripeWebhookEventCompleted(event.id);
      }
    } catch (error) {
      if (claimedEvent) {
        await markStripeWebhookEventFailed(event.id, error);
      }
      throw error;
    }

    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("stripe webhook failed", error);
    return new Response("webhook error", { status: 500 });
  }
}
