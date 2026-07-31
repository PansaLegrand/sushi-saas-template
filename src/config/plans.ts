import type {
  LimitValue,
  PlanDefinition,
  PlanFeature,
  PlanLimit,
  Tier,
} from "@/types/plan";
import {
  PLAN_MONTHLY_CREDITS,
  billingPriceIdsForTier,
} from "@/config/billing";

/**
 * The entitlement catalog — the capabilities and limits each tier receives.
 *
 * This is the file a clone edits. Renaming a tier, moving a feature from Max
 * down to Plus, raising a storage cap, adding a fourth tier: all of it is a
 * change here and nowhere else, because no route, component, or service is
 * allowed to compare a tier name. They ask `can(...)` and `enforceLimit(...)`
 * instead, and `tests/unit/architecture.test.ts` fails the build if anything
 * outside `src/services/entitlements.ts` imports this module.
 *
 * That indirection is the entire design. The version of this system that reads
 * `if (tier === "max")` at forty call sites works fine until the day you add a
 * tier between them, and then it is a grep you will not finish.
 *
 * Adding a feature:
 *   1. Add the key to `PlanFeature` or `PlanLimit` in `src/types/plan.ts`.
 *   2. Fill it in for every tier below — TypeScript will not let you skip one.
 *   3. Guard the call site with `requireEntitlement` / `enforceLimit`.
 *
 * Nothing here does I/O. Price mappings and advertised credit allowances are
 * derived from the commercial catalog in `src/config/billing.ts`, so checkout,
 * renewals, and entitlement sync cannot drift apart.
 */

/** Reads better than a bare `null` in the table below. */
export const UNLIMITED: LimitValue = null;

/**
 * Tiers in ladder order, lowest first.
 *
 * `satisfies` keeps this in step with the `Tier` union: drop a tier here and
 * the catalog below stops satisfying `Record<Tier, ...>`.
 */
export const PLAN_TIERS = ["free", "plus", "max"] as const satisfies readonly Tier[];

/** The tier a user has when nothing entitles them to more. */
export const DEFAULT_TIER: Tier = "free";

/**
 * How long a failed payment keeps its access.
 *
 * Stripe retries a declined card over several days. Cutting someone off the
 * moment the first attempt fails punishes an expired card the same way it
 * punishes a cancellation, and it generates the support ticket you least want.
 * During grace the subscription still entitles; after it, the user falls back
 * to `free` without anything being deleted.
 */
export const PAST_DUE_GRACE_DAYS = 7;

export const PLANS = {
  free: {
    rank: 0,
    name: "Free",
    includedMonthlyCredits: PLAN_MONTHLY_CREDITS.free,
    features: {
      "storage.upload": true,
      "tasks.text_to_video": false,
    },
    limits: {
      // The owner consumes the one Free seat, so Free cannot invite.
      "organization.members": 1,
      "storage.maxFileMb": 5,
      "storage.totalMb": 100,
      "tasks.perMonth": 0,
    },
    // A free tier is never checked out, so it has no price.
    priceIds: [],
  },

  plus: {
    rank: 1,
    name: "Plus",
    includedMonthlyCredits: PLAN_MONTHLY_CREDITS.plus,
    features: {
      "storage.upload": true,
      "tasks.text_to_video": true,
    },
    limits: {
      "organization.members": 5,
      "storage.maxFileMb": 25,
      "storage.totalMb": 5_000,
      "tasks.perMonth": 50,
    },
    priceIds: billingPriceIdsForTier("plus"),
  },

  max: {
    rank: 2,
    name: "Max",
    includedMonthlyCredits: PLAN_MONTHLY_CREDITS.max,
    features: {
      "storage.upload": true,
      "tasks.text_to_video": true,
    },
    limits: {
      "organization.members": 20,
      "storage.maxFileMb": 200,
      "storage.totalMb": 50_000,
      "tasks.perMonth": UNLIMITED,
    },
    priceIds: billingPriceIdsForTier("max"),
  },
} as const satisfies Record<Tier, PlanDefinition>;

/**
 * Price ID → tier, built once.
 *
 * The webhook resolves an incoming subscription this way. A price ID that
 * appears under two tiers is a configuration bug that would silently entitle
 * the wrong one, so it throws at module load rather than at 3am.
 */
const TIER_BY_PRICE_ID: ReadonlyMap<string, Tier> = (() => {
  const map = new Map<string, Tier>();

  for (const tier of PLAN_TIERS) {
    for (const priceId of PLANS[tier].priceIds) {
      const existing = map.get(priceId);
      if (existing && existing !== tier) {
        throw new Error(
          `stripe price ${priceId} is claimed by both "${existing}" and "${tier}" in src/config/plans.ts`
        );
      }
      map.set(priceId, tier);
    }
  }

  return map;
})();

/** The tier a Stripe price entitles, or undefined if it is not one of ours. */
export function tierForPriceId(priceId: string | null | undefined): Tier | undefined {
  if (!priceId) return undefined;
  return TIER_BY_PRICE_ID.get(priceId);
}

/** Narrows an arbitrary string — a database column, say — to a known tier. */
export function isTier(value: string | null | undefined): value is Tier {
  return typeof value === "string" && value in PLANS;
}

export function planFor(tier: Tier): PlanDefinition {
  return PLANS[tier];
}

/** Feature and limit keys, for tests and admin screens that enumerate them. */
export const PLAN_FEATURES = Object.keys(PLANS.free.features) as PlanFeature[];
export const PLAN_LIMITS = Object.keys(PLANS.free.limits) as PlanLimit[];
