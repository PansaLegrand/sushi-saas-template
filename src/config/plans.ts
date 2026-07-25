import type {
  LimitValue,
  PlanDefinition,
  PlanFeature,
  PlanLimit,
  Tier,
} from "@/types/plan";

/**
 * The plan catalog — what each tier costs you to honour, in one place.
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
 * Nothing here does I/O. Price IDs come from the environment because they
 * differ per Stripe account, but they are read once at module load.
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

/**
 * Price IDs are per-Stripe-account, so they come from the environment.
 *
 * `process.env.X` is spelled out rather than looked up dynamically because Next
 * inlines `NEXT_PUBLIC_*` at build time by static analysis — a computed key
 * would be `undefined` in the browser bundle.
 *
 * The `LAUNCH`/`SCALE` names are the ones this kit shipped before tiers
 * existed; they are honoured as fallbacks so an existing deployment keeps
 * working without touching its environment. New setups should use the tier
 * names.
 */
function priceIds(...values: Array<string | undefined>): readonly string[] {
  return values.filter((value): value is string => Boolean(value?.trim()));
}

const PLUS_PRICE_IDS = priceIds(
  process.env.NEXT_PUBLIC_STRIPE_PRICE_PLUS_MONTHLY,
  process.env.NEXT_PUBLIC_STRIPE_PRICE_PLUS_YEARLY,
  process.env.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY,
  process.env.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY,
  process.env.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY_CNY,
  process.env.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY_CNY
);

const MAX_PRICE_IDS = priceIds(
  process.env.NEXT_PUBLIC_STRIPE_PRICE_MAX_MONTHLY,
  process.env.NEXT_PUBLIC_STRIPE_PRICE_MAX_YEARLY,
  process.env.NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY,
  process.env.NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY,
  process.env.NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY_CNY,
  process.env.NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY_CNY
);

export const PLANS = {
  free: {
    rank: 0,
    name: "Free",
    includedMonthlyCredits: 50,
    features: {
      "storage.upload": true,
      "tasks.text_to_video": false,
    },
    limits: {
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
    includedMonthlyCredits: 500,
    features: {
      "storage.upload": true,
      "tasks.text_to_video": true,
    },
    limits: {
      "storage.maxFileMb": 25,
      "storage.totalMb": 5_000,
      "tasks.perMonth": 50,
    },
    priceIds: PLUS_PRICE_IDS,
  },

  max: {
    rank: 2,
    name: "Max",
    includedMonthlyCredits: 2_500,
    features: {
      "storage.upload": true,
      "tasks.text_to_video": true,
    },
    limits: {
      "storage.maxFileMb": 200,
      "storage.totalMb": 50_000,
      "tasks.perMonth": UNLIMITED,
    },
    priceIds: MAX_PRICE_IDS,
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
