import type Stripe from "stripe";

import { newStripeClient } from "@/integrations/stripe";
import { syncStripeSubscription } from "@/services/subscriptions";

import { ActionRequiredError } from "./action-required";

/** Copy Stripe's canonical subscription state into the local entitlement row. */
export async function handleSubscriptionLifecycleEvent(
  event: Stripe.Event,
): Promise<void> {
  const delivered = event.data.object as Stripe.Subscription;

  // Stripe timestamps events only to the second, so two lifecycle events can
  // tie. Fetching the canonical object makes either delivery write the same
  // latest state instead of allowing a late stale payload to regress it.
  const subscription = await newStripeClient()
    .stripe()
    .subscriptions.retrieve(delivered.id);
  const synced = await syncStripeSubscription(
    subscription,
    new Date(event.created * 1000),
  );

  // Every unmapped result is a configuration or data repair, not a transient
  // provider failure. Parking it prevents a failed entitlement from looking
  // indistinguishable from a successfully applied update.
  if (synced.status === "unmapped") {
    throw new ActionRequiredError(`subscription_${synced.reason}`, {
      stripe_subscription_id: subscription.id,
      stripe_customer_id:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id,
    });
  }
}
