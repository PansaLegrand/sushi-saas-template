import Stripe from "stripe";

import { getRequiredEnv, isProductionRuntime } from "@/lib/env";
import { respCode } from "@/lib/errors/response";
import { logger } from "@/lib/logger/server";
import { processStripeWebhookEvent } from "@/services/stripe/webhook";

// Stripe sends signed POST requests to this endpoint. The route owns only the
// transport boundary; durable claims and payment policy live in the service.
export async function POST(req: Request) {
  let stripeEventId: string | undefined;
  let stripeEventType: string | undefined;

  try {
    const signature = req.headers.get("stripe-signature");
    if (!signature) return respCode("PAYMENT_WEBHOOK_INVALID_SIGNATURE");

    const rawBody = await req.text();
    const event = constructStripeEvent(rawBody, signature);
    if (!event) return respCode("PAYMENT_WEBHOOK_INVALID_SIGNATURE");

    stripeEventId = event.id;
    stripeEventType = event.type;

    // A verified test-mode event in production means the endpoint holds the
    // wrong signing secret. Reject before claiming or granting anything. A 4xx
    // stops retries and surfaces the deployment error in Stripe's dashboard.
    if (isProductionRuntime() && event.livemode !== true) {
      logger.error(
        {
          event: "pay.webhook_test_mode_rejected",
          stripe_event_id: event.id,
          stripe_event_type: event.type,
        },
        "rejected a test-mode stripe event in production",
      );
      return new Response("test-mode event rejected", { status: 400 });
    }

    const result = await processStripeWebhookEvent(event, rawBody);
    return new Response(result.body, { status: result.status });
  } catch (error) {
    logger.error(
      {
        err: error,
        event: "pay.webhook_failed",
        stripe_event_id: stripeEventId,
        stripe_event_type: stripeEventType,
      },
      "stripe webhook failed",
    );
    return new Response("webhook error", { status: 500 });
  }
}

function constructStripeEvent(
  rawBody: string,
  signature: string,
): Stripe.Event | undefined {
  try {
    return Stripe.webhooks.constructEvent(
      rawBody,
      signature,
      getRequiredEnv("STRIPE_WEBHOOK_SECRET"),
    );
  } catch (error) {
    logger.warn(
      {
        event: "pay.webhook_invalid_signature",
        error_name: error instanceof Error ? error.name : "UnknownError",
        error_message:
          error instanceof Error
            ? error.message
            : "signature verification failed",
      },
      "invalid stripe signature",
    );
    return undefined;
  }
}
