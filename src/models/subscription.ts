import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { subscriptions } from "@/db/schema";

/** A subscription row. Exported so services can type over rows without importing the schema. */
export type SubscriptionRow = typeof subscriptions.$inferSelect;

/**
 * Stripe's own status vocabulary, kept verbatim.
 *
 * Deliberately not remapped to something friendlier: when a customer disputes
 * what they were charged, the value in this column has to be comparable to
 * what the Stripe dashboard shows, without a translation table in between.
 */
export const SubscriptionStatus = {
  Trialing: "trialing",
  Active: "active",
  PastDue: "past_due",
  Canceled: "canceled",
  Incomplete: "incomplete",
  IncompleteExpired: "incomplete_expired",
  Unpaid: "unpaid",
  Paused: "paused",
} as const;

export type SubscriptionStatusValue =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const SubscriptionSource = {
  /** Created and maintained by Stripe webhooks. */
  Stripe: "stripe",
  /** Comped by an admin. Has no Stripe subscription behind it. */
  Manual: "manual",
} as const;

export type SubscriptionSourceValue =
  (typeof SubscriptionSource)[keyof typeof SubscriptionSource];

export type UpsertStripeSubscriptionInput = {
  uuid: string;
  user_uuid: string;
  stripe_subscription_id: string;
  stripe_customer_id?: string | null;
  stripe_price_id?: string | null;
  tier: string;
  status: string;
  current_period_start?: Date | null;
  current_period_end?: Date | null;
  trial_end?: Date | null;
  cancel_at_period_end?: boolean;
  ended_at?: Date | null;
  /** When Stripe emitted the event being applied. Required — see below. */
  stripe_event_at: Date;
};

export type UpsertResult = {
  /**
   * False when the write was dropped because the row already reflects a newer
   * event. Callers should treat this as success, not failure: the newer state
   * is the one we want.
   */
  applied: boolean;
  row?: SubscriptionRow;
};

/**
 * Insert or update the row for a Stripe subscription, newest event wins.
 *
 * Webhooks are not ordered. Stripe retries a failed delivery for up to three
 * days, so a `customer.subscription.updated` from 09:00 can arrive after the
 * `customer.subscription.deleted` from 09:05 — and applying it blindly
 * resurrects a cancelled subscription, handing someone a paid tier they no
 * longer pay for. The `setWhere` clause below is what prevents that: the update
 * only fires when the incoming event is at least as new as the one already
 * recorded.
 *
 * This also makes redelivery of the *same* event harmless, which is the second
 * property a webhook handler needs.
 */
export async function upsertStripeSubscription(
  input: UpsertStripeSubscriptionInput
): Promise<UpsertResult> {
  const now = new Date();

  const values = {
    uuid: input.uuid,
    user_uuid: input.user_uuid,
    stripe_subscription_id: input.stripe_subscription_id,
    stripe_customer_id: input.stripe_customer_id ?? null,
    stripe_price_id: input.stripe_price_id ?? null,
    tier: input.tier,
    status: input.status,
    source: SubscriptionSource.Stripe,
    current_period_start: input.current_period_start ?? null,
    current_period_end: input.current_period_end ?? null,
    trial_end: input.trial_end ?? null,
    cancel_at_period_end: input.cancel_at_period_end ?? false,
    ended_at: input.ended_at ?? null,
    stripe_event_at: input.stripe_event_at,
    updated_at: now,
  };

  const [row] = await db()
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: subscriptions.stripe_subscription_id,
      set: {
        // `uuid` and `created_at` are intentionally absent: the row keeps the
        // identity it was created with.
        user_uuid: values.user_uuid,
        stripe_customer_id: values.stripe_customer_id,
        stripe_price_id: values.stripe_price_id,
        tier: values.tier,
        status: values.status,
        current_period_start: values.current_period_start,
        current_period_end: values.current_period_end,
        trial_end: values.trial_end,
        cancel_at_period_end: values.cancel_at_period_end,
        ended_at: values.ended_at,
        stripe_event_at: values.stripe_event_at,
        updated_at: now,
      },
      setWhere: sql`${subscriptions.stripe_event_at} is null or ${subscriptions.stripe_event_at} <= excluded.stripe_event_at`,
    })
    .returning();

  // No row came back: the conflict target matched but `setWhere` rejected the
  // update, i.e. what is stored is newer than what just arrived.
  return { applied: Boolean(row), row };
}

export async function findSubscriptionByStripeId(
  stripeSubscriptionId: string
): Promise<SubscriptionRow | undefined> {
  const [row] = await db()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripe_subscription_id, stripeSubscriptionId))
    .limit(1);

  return row;
}

/**
 * Every subscription row for a user, optionally narrowed to a set of statuses.
 *
 * The status filter is a parameter rather than a constant here because *which*
 * statuses still entitle someone is a product decision — past_due entitles
 * during its grace period, and that rule belongs in the entitlement service,
 * not in a CRUD helper.
 */
export async function listSubscriptionsByUserUuid(
  userUuid: string,
  options: { statuses?: readonly string[] } = {}
): Promise<SubscriptionRow[]> {
  const statuses = options.statuses;

  return db()
    .select()
    .from(subscriptions)
    .where(
      statuses?.length
        ? and(
            eq(subscriptions.user_uuid, userUuid),
            inArray(subscriptions.status, [...statuses])
          )
        : eq(subscriptions.user_uuid, userUuid)
    )
    .orderBy(desc(subscriptions.updated_at));
}

export type InsertManualSubscriptionInput = {
  uuid: string;
  user_uuid: string;
  tier: string;
  status: string;
  current_period_end?: Date | null;
  note?: string | null;
};

/** Comp a user onto a tier without Stripe. See `docs/plans.md`. */
export async function insertManualSubscription(
  input: InsertManualSubscriptionInput
): Promise<SubscriptionRow | undefined> {
  const [row] = await db()
    .insert(subscriptions)
    .values({
      uuid: input.uuid,
      user_uuid: input.user_uuid,
      tier: input.tier,
      status: input.status,
      source: SubscriptionSource.Manual,
      current_period_end: input.current_period_end ?? null,
      note: input.note ?? null,
    })
    .returning();

  return row;
}

/** End a subscription row locally. Used to revoke a comp. */
export async function endSubscription(
  uuid: string,
  status: string = SubscriptionStatus.Canceled
): Promise<SubscriptionRow | undefined> {
  const now = new Date();

  const [row] = await db()
    .update(subscriptions)
    .set({ status, ended_at: now, updated_at: now })
    .where(eq(subscriptions.uuid, uuid))
    .returning();

  return row;
}
