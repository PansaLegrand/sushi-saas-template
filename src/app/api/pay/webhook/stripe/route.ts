import Stripe from "stripe";
import { newStripeClient } from "@/integrations/stripe";
import { handleCheckoutSession } from "@/services/stripe";

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

    const client = newStripeClient();
    const stripe = client.stripe();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      console.warn("invalid stripe signature", err);
      return new Response("invalid signature", { status: 400 });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSession(stripe, session);
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

