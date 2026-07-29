/**
 * The vocabulary of the plan system.
 *
 * This file names the tiers, the things a tier can unlock, and the things a
 * tier can cap. The *values* live in `src/config/plans.ts`; the names live here
 * so that three separate needs are met at once:
 *
 * 1. The catalog can be typed against these unions, which makes "this tier
 *    forgot to declare `tasks.perMonth`" a compile error rather than a runtime
 *    surprise on someone's paid account.
 * 2. Client components can talk about a `Tier` without importing the catalog.
 * 3. Adding a feature is a two-line diff — a key here, a value per tier there —
 *    which is the whole point of routing authorization through entitlements
 *    instead of `if (tier === "max")`.
 *
 * Types only. Nothing in this file is imported for its runtime value.
 */

/**
 * Tiers, in the order a user climbs them.
 *
 * `free` is a real tier with a real row in the catalog, not the absence of a
 * subscription. Every user resolves to exactly one tier, always — which is why
 * no call site anywhere needs a null check before asking what someone may do.
 */
export type Tier = "free" | "plus" | "max";

/** A capability a tier either has or does not have. */
export type PlanFeature =
  | "storage.upload"
  | "tasks.text_to_video";

/** A capability every tier has, but in a bounded amount. */
export type PlanLimit =
  | "storage.maxFileMb"
  | "storage.totalMb"
  | "tasks.perMonth";

/**
 * A cap, where `null` means unbounded.
 *
 * One representation, deliberately. `Infinity` reads better in a comparison but
 * does not survive `JSON.stringify` (it becomes `null` anyway, silently), so a
 * catalog written with `Infinity` would mean one thing on the server and
 * another in the browser. Comparisons go through `enforceLimit` /
 * `isWithinLimit` instead, so no call site writes the null check by hand.
 */
export type LimitValue = number | null;

/**
 * One tier's complete definition.
 *
 * `Record<PlanFeature, boolean>` rather than `Partial<...>` on purpose: every
 * tier must answer for every feature. A tier that omits a key does not quietly
 * default to `false` — it fails to compile, and the person adding the feature
 * is made to decide what it means for each tier they already sell.
 */
export type PlanDefinition = {
  /**
   * Position in the ladder. Higher wins when a user somehow holds two
   * subscriptions, and drives "requires Plus or above" comparisons without
   * anyone hardcoding an order.
   */
  rank: number;
  /** Display name. User-facing, so keep it short. */
  name: string;
  /**
   * Credits this tier includes per month, for display on pricing and billing
   * screens. Paid product grants are derived from the same value in
   * `src/config/billing.ts`; the free tier remains zero until a recurring grant
   * job is configured.
   */
  includedMonthlyCredits: number;
  features: Record<PlanFeature, boolean>;
  limits: Record<PlanLimit, LimitValue>;
  /**
   * Stripe price IDs that entitle a user to this tier, across every interval
   * and currency you sell. Used in one direction only — webhook price → tier —
   * so listing an old price ID here keeps grandfathered subscribers working.
   */
  priceIds: readonly string[];
};

/** The live subscription behind a resolved plan, when there is one. */
export type SubscriptionSnapshot = {
  status: string;
  /** ISO 8601. When the current paid period ends, if known. */
  currentPeriodEnd: string | null;
  /** True when Stripe will not renew at `currentPeriodEnd`. */
  cancelAtPeriodEnd: boolean;
  /** `stripe` for a paid subscription, `manual` for a comped one. */
  source: string;
};

/**
 * One independently billed/granted subscription shown on the billing screen.
 *
 * `PlanSnapshot.subscription` remains the single row that determines feature
 * limits. This list is deliberately separate: organizations may stack several
 * subscriptions, and hiding all but the highest tier would hide real recurring
 * charges and credit grants.
 */
export type BillingSubscriptionSnapshot = SubscriptionSnapshot & {
  id: string;
  tier: Tier | null;
  name: string;
  includedMonthlyCredits: number;
  /** Whether this row currently contributes an entitlement. */
  entitling: boolean;
  /** Whether this is the row whose tier supplies the effective feature limits. */
  effective: boolean;
};

/**
 * Everything the UI needs to render plan state, in one serializable object.
 *
 * Sent by `GET /api/account/plan` and passed into `PlanProvider` by server
 * components. It carries the resolved feature and limit maps rather than just
 * the tier name so a client can answer `can("storage.upload")` without a
 * second round trip — and, more importantly, so the client and the server are
 * reading the *same* answer instead of two copies of the rules.
 */
export type PlanSnapshot = {
  tier: Tier;
  name: string;
  rank: number;
  includedMonthlyCredits: number;
  features: Record<PlanFeature, boolean>;
  limits: Record<PlanLimit, LimitValue>;
  /** The one subscription that determines effective feature limits. */
  subscription: SubscriptionSnapshot | null;
  /** Every current subscription, including multiple subscriptions on one tier. */
  subscriptions: BillingSubscriptionSnapshot[];
};
