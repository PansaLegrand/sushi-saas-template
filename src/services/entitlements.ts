import { cache } from "react";

import {
  DEFAULT_TIER,
  PAST_DUE_GRACE_DAYS,
  PLANS,
  PLAN_TIERS,
  isTier,
  planFor,
  tierForPriceId,
} from "@/config/plans";
import { AppError } from "@/lib/errors/app-error";
import {
  SubscriptionStatus,
  listSubscriptionsByUserUuid,
  type SubscriptionRow,
} from "@/models/subscription";
import type {
  LimitValue,
  PlanDefinition,
  PlanFeature,
  PlanLimit,
  PlanSnapshot,
  Tier,
} from "@/types/plan";

/**
 * Entitlements: the one place that answers "may this user do this?".
 *
 * Everything above this file — routes, services, pages, components — asks in
 * terms of a capability:
 *
 *     await requireEntitlement(userUuid, "tasks.text_to_video");
 *     await enforceLimit(userUuid, "storage.totalMb", { current, adding });
 *
 * and never in terms of a tier. That is enforced, not merely encouraged:
 * `tests/unit/architecture.test.ts` fails the build if any other file imports
 * `@/config/plans`. The payoff is that adding a `team` tier, or moving a
 * feature down from Max to Plus, is a change to the catalog and nothing else.
 *
 * The other thing this module owns is the *definition of entitled*. A
 * subscription that is `past_due` still entitles for a grace period, because a
 * card that expired on Tuesday is not a cancellation. Keeping that judgement
 * here means it applies identically to every feature — the alternative is
 * discovering that uploads honour the grace period and video generation does
 * not.
 */

export type ResolvedPlan = {
  tier: Tier;
  plan: PlanDefinition;
  /** The row that granted this tier, or null when the user is on the default. */
  subscription: SubscriptionRow | null;
};

/**
 * Statuses worth fetching. `canceled`, `incomplete_expired` and `unpaid` can
 * never entitle, so they are filtered in the query rather than in memory —
 * this list is the only reason a long-cancelled row does not have to be read
 * on every request of a user's life.
 */
const CANDIDATE_STATUSES = [
  SubscriptionStatus.Trialing,
  SubscriptionStatus.Active,
  SubscriptionStatus.PastDue,
] as const;

const GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Does this row currently entitle its user to its tier?
 *
 * Exported for tests, which is the honest reason: this predicate encodes a
 * product decision about money, and it deserves to be asserted directly rather
 * than through four layers of mocking.
 */
export function isEntitling(row: SubscriptionRow, now: Date = new Date()): boolean {
  if (row.ended_at && row.ended_at.getTime() <= now.getTime()) return false;

  switch (row.status) {
    case SubscriptionStatus.Active:
    case SubscriptionStatus.Trialing:
      // A cancelled-at-period-end subscription is still active until the period
      // actually ends — the user paid for the rest of the month.
      return !isExpired(row, now);

    case SubscriptionStatus.PastDue: {
      // Stripe retries a declined card for days. Cutting access off on the
      // first failure treats an expired card like a cancellation.
      const from = row.current_period_end ?? row.updated_at;
      return now.getTime() - from.getTime() <= GRACE_MS;
    }

    default:
      return false;
  }
}

function isExpired(row: SubscriptionRow, now: Date): boolean {
  // A manual comp with no end date never expires; that is what "comped
  // indefinitely" means.
  if (!row.current_period_end) return false;
  return row.current_period_end.getTime() <= now.getTime();
}

/**
 * Resolve the plan a user is on right now.
 *
 * Memoized per request with React's `cache`, so a page that checks five
 * different entitlements issues one query rather than five. Outside a request
 * — a cron job, a test — `cache` is a passthrough, which is the correct
 * behaviour there anyway.
 *
 * The one thing to know about that memoization: a request that *changes* a
 * user's subscription and then reads it back gets the value from before the
 * change. Handlers that comp or revoke should resolve after mutating, never
 * before — which is what the admin plan route does.
 */
export const resolvePlan = cache(async function resolvePlan(
  userUuid: string | null | undefined
): Promise<ResolvedPlan> {
  if (!userUuid) return freePlan();

  const rows = await listSubscriptionsByUserUuid(userUuid, {
    statuses: CANDIDATE_STATUSES,
  });

  const now = new Date();
  let best: { row: SubscriptionRow; tier: Tier } | null = null;

  for (const row of rows) {
    if (!isEntitling(row, now)) continue;
    if (!isTier(row.tier)) continue; // A tier removed from the catalog since.

    // Highest tier wins. A user can legitimately hold two rows at once — a
    // comped Max alongside a paid Plus, say — and taking the most recent
    // instead of the best would quietly downgrade them.
    if (!best || planFor(row.tier).rank > planFor(best.tier).rank) {
      best = { row, tier: row.tier };
    }
  }

  if (!best) return freePlan();

  return { tier: best.tier, plan: planFor(best.tier), subscription: best.row };
});

function freePlan(): ResolvedPlan {
  return { tier: DEFAULT_TIER, plan: planFor(DEFAULT_TIER), subscription: null };
}

// ---------------------------------------------------------------- features

/** Does this user's plan include `feature`? */
export async function can(
  userUuid: string | null | undefined,
  feature: PlanFeature
): Promise<boolean> {
  const { plan } = await resolvePlan(userUuid);
  return plan.features[feature];
}

/**
 * Throw unless this user's plan includes `feature`.
 *
 * The thrown `AppError` carries the lowest tier that *would* include it, so
 * the client can render "available on Plus" without owning a second copy of
 * the catalog. `details` is user-safe by construction — a tier name and a
 * feature key, nothing else.
 */
export async function requireEntitlement(
  userUuid: string | null | undefined,
  feature: PlanFeature
): Promise<ResolvedPlan> {
  const resolved = await resolvePlan(userUuid);
  if (resolved.plan.features[feature]) return resolved;

  throw new AppError("PLAN_UPGRADE_REQUIRED", {
    message: `plan "${resolved.tier}" does not include feature "${feature}"`,
    details: {
      feature,
      tier: resolved.tier,
      requiredTier: lowestTierWith(feature),
    },
  });
}

/** The cheapest tier that includes `feature`, or null if no tier does. */
export function lowestTierWith(feature: PlanFeature): Tier | null {
  const candidates = PLAN_TIERS.filter((tier) => PLANS[tier].features[feature]);
  if (candidates.length === 0) return null;

  return candidates.reduce((cheapest, tier) =>
    planFor(tier).rank < planFor(cheapest).rank ? tier : cheapest
  );
}

// ------------------------------------------------------------------ limits

/** This user's cap for `limit`. `null` means unlimited. */
export async function limitOf(
  userUuid: string | null | undefined,
  limit: PlanLimit
): Promise<LimitValue> {
  const { plan } = await resolvePlan(userUuid);
  return plan.limits[limit];
}

export type LimitUsage = {
  /** How much of the allowance is already used. */
  current: number;
  /** How much this request would add. Defaults to 1. */
  adding?: number;
};

/** Pure form of the check, so the arithmetic can be tested without a database. */
export function isWithinLimit(max: LimitValue, usage: LimitUsage): boolean {
  if (max === null) return true;
  return usage.current + (usage.adding ?? 1) <= max;
}

/**
 * Throw unless this request keeps the user within their plan's cap.
 *
 * Deliberately checked at the moment of creation and nowhere else. When a user
 * downgrades below what they already hold — ten files on a plan that allows
 * three — the existing resources stay readable and only *new* ones are
 * refused. Nothing in this kit deletes a user's data because their plan
 * changed, and nothing should: see `docs/plans.md`.
 */
export async function enforceLimit(
  userUuid: string | null | undefined,
  limit: PlanLimit,
  usage: LimitUsage
): Promise<void> {
  const { tier, plan } = await resolvePlan(userUuid);
  const max = plan.limits[limit];

  if (isWithinLimit(max, usage)) return;

  throw new AppError("PLAN_LIMIT_EXCEEDED", {
    message: `plan "${tier}" limit "${limit}" exceeded: ${usage.current} + ${usage.adding ?? 1} > ${max}`,
    details: {
      limit,
      tier,
      max,
      current: usage.current,
      requiredTier: lowestTierAllowing(limit, usage),
    },
  });
}

/** The cheapest tier whose cap would accommodate `usage`, or null if none does. */
export function lowestTierAllowing(limit: PlanLimit, usage: LimitUsage): Tier | null {
  const candidates = PLAN_TIERS.filter((tier) =>
    isWithinLimit(PLANS[tier].limits[limit], usage)
  );
  if (candidates.length === 0) return null;

  return candidates.reduce((cheapest, tier) =>
    planFor(tier).rank < planFor(cheapest).rank ? tier : cheapest
  );
}

// ----------------------------------------------------------------- reading

/**
 * The serializable view of a user's plan, for the API and for server
 * components handing state to `PlanProvider`.
 *
 * Carries the resolved feature and limit maps, not just the tier name, so the
 * browser answers `can(...)` from the same values the server used instead of
 * from a second copy of the rules that can drift.
 */
export async function getPlanSnapshot(
  userUuid: string | null | undefined
): Promise<PlanSnapshot> {
  const { tier, plan, subscription } = await resolvePlan(userUuid);

  return {
    tier,
    name: plan.name,
    rank: plan.rank,
    includedMonthlyCredits: plan.includedMonthlyCredits,
    features: { ...plan.features },
    limits: { ...plan.limits },
    subscription: subscription
      ? {
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end?.toISOString() ?? null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          source: subscription.source,
        }
      : null,
  };
}

/**
 * Every tier, for pricing and billing screens.
 *
 * Exists so the UI can render a comparison table without importing the
 * catalog — the same single-door rule that keeps tier names out of route code
 * keeps them out of components.
 */
export function describePlans(): Array<{ tier: Tier } & PlanDefinition> {
  return PLAN_TIERS.map((tier) => ({ tier, ...planFor(tier) }));
}

/**
 * The best tier among a set of Stripe prices.
 *
 * A subscription can carry several line items — a base plan plus an add-on —
 * and only some of them map to a tier. Taking the highest-ranked match means
 * an add-on priced separately can never accidentally demote the plan it was
 * added to.
 */
export function tierForPriceIds(
  priceIds: Iterable<string | null | undefined>
): Tier | undefined {
  let best: Tier | undefined;

  for (const priceId of priceIds) {
    const tier = tierForPriceId(priceId);
    if (!tier) continue;
    if (!best || planFor(tier).rank > planFor(best).rank) best = tier;
  }

  return best;
}

/**
 * Which tier a Stripe price entitles. Re-exported rather than imported from
 * the catalog directly so the webhook goes through the same door as everyone
 * else.
 */
export { tierForPriceId, isTier };
