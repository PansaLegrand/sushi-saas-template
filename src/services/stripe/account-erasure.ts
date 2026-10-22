import { throwIfAborted } from "@/lib/abort";
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
  signal?: AbortSignal;
}): Promise<void> {
  throwIfAborted(input.signal);
  const stripe = newStripeClient().stripe();

  try {
    await stripe.subscriptions.cancel(
      input.subscriptionId,
      {},
      {
        timeout: 10_000,
        maxNetworkRetries: 0,
        idempotencyKey: `account-erasure:${input.requestUuid}:subscription:${input.subscriptionId}`,
      },
    );
    throwIfAborted(input.signal);
  } catch (cause) {
    throwIfAborted(input.signal);
    const current = await stripe.subscriptions.retrieve(
      input.subscriptionId,
      {},
      { timeout: 10_000, maxNetworkRetries: 0 },
    );
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
  signal?: AbortSignal;
  onSubscription?: (id: string) => Promise<void>;
}): Promise<string[]> {
  throwIfAborted(input.signal);
  const stripe = newStripeClient().stripe();
  const canceled: string[] = [];
  // Iterate pages lazily so the owning workflow can checkpoint/yield after
  // each subscription instead of loading an unbounded customer snapshot.
  for await (const subscription of stripe.subscriptions.list(
    {
      customer: input.customerId,
      status: "all",
      limit: 100,
    },
    { timeout: 10_000, maxNetworkRetries: 0 },
  )) {
    throwIfAborted(input.signal);
    if (
      subscription.status !== "canceled" &&
      subscription.status !== "incomplete_expired"
    ) {
      await cancelStripeSubscriptionForErasure({
        subscriptionId: subscription.id,
        requestUuid: input.requestUuid,
        signal: input.signal,
      });
    }
    await input.onSubscription?.(subscription.id);
    canceled.push(subscription.id);
  }

  return canceled;
}

/** Delete a Stripe customer only after all of its subscriptions are canceled. */
export async function deleteStripeCustomerForErasure(input: {
  customerId: string;
  requestUuid: string;
  signal?: AbortSignal;
}): Promise<void> {
  throwIfAborted(input.signal);
  const stripe = newStripeClient().stripe();

  try {
    await stripe.customers.del(
      input.customerId,
      {},
      {
        timeout: 10_000,
        maxNetworkRetries: 0,
        idempotencyKey: `account-erasure:${input.requestUuid}:customer:${input.customerId}`,
      },
    );
    throwIfAborted(input.signal);
  } catch (cause) {
    throwIfAborted(input.signal);
    // Stripe returns resource_missing when a previous attempt deleted the
    // customer but the worker crashed before recording that effect.
    if (isStripeResourceMissing(cause)) return;
    throw cause;
  }
}
