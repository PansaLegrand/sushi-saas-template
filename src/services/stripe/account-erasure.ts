import { newStripeClient } from "@/integrations/stripe";

function isStripeResourceMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "resource_missing"
  );
}

/**
 * Cancel one subscription immediately.
 *
 * The deterministic key and terminal-state fallback make a replay safe after a
 * worker crash. This is deliberately separate from checkout: teardown has a
 * different invariant and must never create or modify a purchase intent.
 */
export async function cancelStripeSubscriptionForErasure(input: {
  subscriptionId: string;
  requestUuid: string;
}): Promise<void> {
  const stripe = newStripeClient().stripe();

  try {
    await stripe.subscriptions.cancel(
      input.subscriptionId,
      {},
      {
        idempotencyKey: `account-erasure:${input.requestUuid}:subscription:${input.subscriptionId}`,
      },
    );
  } catch (cause) {
    const current = await stripe.subscriptions.retrieve(input.subscriptionId);
    if (
      current.status === "canceled" ||
      current.status === "incomplete_expired"
    ) {
      return;
    }
    throw cause;
  }
}

/**
 * Discover subscriptions from Stripe itself, not only the local webhook
 * projection. This closes the gap where checkout succeeded but its webhook has
 * not populated `subscriptions` yet when account erasure begins.
 */
export async function cancelStripeCustomerSubscriptionsForErasure(input: {
  customerId: string;
  requestUuid: string;
}): Promise<string[]> {
  const stripe = newStripeClient().stripe();
  const page = await stripe.subscriptions
    .list({
      customer: input.customerId,
      status: "all",
      limit: 100,
    })
    .autoPagingToArray({ limit: 10_000 });

  const canceled: string[] = [];
  for (const subscription of page) {
    if (
      subscription.status !== "canceled" &&
      subscription.status !== "incomplete_expired"
    ) {
      await cancelStripeSubscriptionForErasure({
        subscriptionId: subscription.id,
        requestUuid: input.requestUuid,
      });
    }
    canceled.push(subscription.id);
  }

  return canceled;
}

/** Delete a Stripe customer only after all of its subscriptions are canceled. */
export async function deleteStripeCustomerForErasure(input: {
  customerId: string;
  requestUuid: string;
}): Promise<void> {
  const stripe = newStripeClient().stripe();

  try {
    await stripe.customers.del(
      input.customerId,
      {},
      {
        idempotencyKey: `account-erasure:${input.requestUuid}:customer:${input.customerId}`,
      },
    );
  } catch (cause) {
    // Stripe returns resource_missing when a previous attempt deleted the
    // customer but the worker crashed before recording that effect.
    if (isStripeResourceMissing(cause)) return;
    throw cause;
  }
}
