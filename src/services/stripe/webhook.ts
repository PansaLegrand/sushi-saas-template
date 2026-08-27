import type Stripe from "stripe";

import {
  claimStripeWebhookEvent,
  markStripeWebhookEventActionRequired,
  markStripeWebhookEventCompleted,
  markStripeWebhookEventFailed,
} from "@/models/stripe-webhook-event";
import { logger } from "@/lib/logger/server";

import { isActionRequired } from "./action-required";
import {
  handleExpiredCheckoutEvent,
  handleFailedInvoiceEvent,
  handlePaidCheckoutEvent,
} from "./webhook-checkout";
import { handleRefundOrDisputeEvent } from "./webhook-refund";
import { handleRenewalInvoiceEvent } from "./webhook-renewal";
import { extractWebhookReceipt } from "./receipt";
import { handleSubscriptionLifecycleEvent } from "./webhook-subscription";

const CLAIMED_EVENT_TYPES = new Set<Stripe.Event.Type>([
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded",
  "charge.dispute.created",
]);

export type StripeWebhookResult = {
  status: 200 | 409;
  body: "ok" | "event already processing" | "action required";
};

/**
 * Apply one verified Stripe event with durable claim and outcome tracking.
 *
 * Signature verification stays at the HTTP boundary. Everything after that is
 * business policy: which events are idempotent, which failures should retry,
 * and which permanent discrepancies require an operator.
 */
export async function processStripeWebhookEvent(
  event: Stripe.Event,
  rawBody: string,
): Promise<StripeWebhookResult> {
  const claimed = CLAIMED_EVENT_TYPES.has(event.type);
  if (claimed) {
    const claimStatus = await claimStripeWebhookEvent({
      eventId: event.id,
      eventType: event.type,
      payload: rawBody,
      receipt: extractWebhookReceipt(event),
    });

    if (claimStatus === "completed") {
      return { status: 200, body: "ok" };
    }
    if (claimStatus === "processing") {
      return { status: 409, body: "event already processing" };
    }
  }

  try {
    await dispatchStripeWebhookEvent(event);
    if (claimed) await markStripeWebhookEventCompleted(event.id);
  } catch (error) {
    if (isActionRequired(error)) {
      if (claimed) {
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
        "stripe webhook needs manual action",
      );
      return { status: 200, body: "action required" };
    }

    if (claimed) await markStripeWebhookEventFailed(event.id, error);
    throw error;
  }

  return { status: 200, body: "ok" };
}

async function dispatchStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await handlePaidCheckoutEvent(event);
      return;

    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      await handleExpiredCheckoutEvent(event);
      return;

    case "invoice.payment_succeeded":
      await handleRenewalInvoiceEvent(event);
      return;

    case "invoice.payment_failed":
      await handleFailedInvoiceEvent(event);
      return;

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionLifecycleEvent(event);
      return;

    case "charge.refunded":
    case "charge.dispute.created":
      await handleRefundOrDisputeEvent(event);
      return;

    default:
      // Stripe endpoints commonly receive more event types than they consume.
      return;
  }
}
