import Stripe from "stripe";
import { handleCheckoutSession } from "@/services/stripe";
import { sendPaymentSuccessEmail, sendPaymentFailedEmail, sendReservationConfirmedEmail } from "@/services/email/send";
import { markReservationConfirmed, findReservationByNo, getServiceById } from "@/features/reservations/models";
import { buildReservationICS } from "@/features/reservations/ics";
import { buildGoogleCalendarUrl } from "@/features/reservations/google";
import { ReservationsConfig } from "@/features/reservations/config";

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

    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      return new Response("webhook secret not configured", { status: 500 });
    }

    const rawBody = await req.text();

    let event: Stripe.Event;
    try {
      // Verify using static helper; no API key needed.
      event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      console.warn("invalid stripe signature", err);
      return new Response("invalid signature", { status: 400 });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const apiKey = process.env.STRIPE_PRIVATE_KEY;
        if (!apiKey) {
          return new Response("stripe secret not configured", { status: 500 });
        }
        const stripe = new Stripe(apiKey);
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
                  url: process.env.NEXT_PUBLIC_WEB_URL ? `${process.env.NEXT_PUBLIC_WEB_URL}/en/reserve?reservation_no=${reservationNo}` : undefined,
                });
                const googleUrl = buildGoogleCalendarUrl({
                  title: `Reservation: ${svc?.title ?? "Service"}`,
                  start,
                  end,
                  description: `Reservation #${reservationNo}`,
                  timeZone: ReservationsConfig.baseTimeZone,
                });
                queueMicrotask(() => {
                  sendReservationConfirmedEmail(to, {
                    reservationNo,
                    serviceTitle: svc?.title ?? undefined,
                    startsAt: start.toISOString(),
                    timezone: confirmed.timezone ?? undefined,
                    icsContent: ics,
                    googleCalendarUrl: googleUrl,
                  }).catch((e) => console.error("reservation email failed", e));
                });
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
          queueMicrotask(() => {
            sendPaymentSuccessEmail(to, { orderNo, amount, currency }).catch((e) => {
              console.error("payment email failed", e);
            });
          });
        }
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const to = invoice.customer_email || (invoice.customer as string | null) || null;
        if (invoice.customer_email) {
          const amountDue = typeof invoice.amount_due === "number" ? invoice.amount_due / 100 : undefined;
          const manageUrlBase = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
          const manageUrl = `${manageUrlBase}/en/account/billing`;
          queueMicrotask(() => {
            sendPaymentFailedEmail(invoice.customer_email!, {
              invoiceNumber: invoice.number || invoice.id,
              amount: amountDue,
              currency: invoice.currency || undefined,
              manageUrl,
            }).catch((e) => console.error("dunning email failed", e));
          });
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

    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("stripe webhook failed", error);
    return new Response("webhook error", { status: 500 });
  }
}
