import type { Tier } from "@/types/plan";

/**
 * The commercial catalog.
 *
 * Amounts, credit grants, billing intervals, and Stripe Price mappings belong
 * together because a checkout and its renewal must answer those questions
 * identically. Presentation copy stays in `config/pricing.ts`; authorization
 * capabilities stay in `config/plans.ts`.
 */

export type PaidTier = Exclude<Tier, "free">;
export type BillingInterval = "month" | "year" | "one-time";
export type BillingCurrency = "usd" | "cny";
export type BillingProductId =
  | "plus-monthly"
  | "max-monthly"
  | "plus-yearly"
  | "max-yearly";

export const PLAN_MONTHLY_CREDITS = {
  // Signup credits are a separate, one-time onboarding grant. This value is
  // deliberately zero until a recurring free-tier grant job exists.
  free: 0,
  plus: 500,
  max: 2_500,
} as const satisfies Record<Tier, number>;

export type BillingPrice = {
  currency: BillingCurrency;
  /** Minor units: cents for USD and fen for CNY. */
  amount: number;
  /**
   * First ID is used for new checkouts. Remaining IDs keep grandfathered
   * subscriptions mappable after an environment-variable migration.
   */
  stripePriceIds: readonly string[];
};

export type BillingProduct = {
  id: BillingProductId;
  legacyIds: readonly string[];
  name: string;
  tier: PaidTier;
  interval: BillingInterval;
  validMonths: number;
  /** Credits granted once per successful Stripe billing period. */
  credits: number;
  prices: Partial<Record<BillingCurrency, BillingPrice>>;
};

export type BillingCatalogEnvironment = {
  [name: string]: string | undefined;
  STRIPE_PRICE_PLUS_MONTHLY?: string;
  STRIPE_PRICE_PLUS_YEARLY?: string;
  STRIPE_PRICE_MAX_MONTHLY?: string;
  STRIPE_PRICE_MAX_YEARLY?: string;
  STRIPE_PRICE_PLUS_MONTHLY_CNY?: string;
  STRIPE_PRICE_PLUS_YEARLY_CNY?: string;
  STRIPE_PRICE_MAX_MONTHLY_CNY?: string;
  STRIPE_PRICE_MAX_YEARLY_CNY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_PLUS_MONTHLY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_PLUS_YEARLY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_MAX_MONTHLY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_MAX_YEARLY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_PLUS_MONTHLY_CNY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_PLUS_YEARLY_CNY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_MAX_MONTHLY_CNY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_MAX_YEARLY_CNY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY_CNY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY_CNY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY_CNY?: string;
  NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY_CNY?: string;
};

function priceIds(...values: Array<string | undefined>): readonly string[] {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    ),
  ];
}

function price(
  currency: BillingCurrency,
  amount: number,
  ...ids: Array<string | undefined>
): BillingPrice {
  return { currency, amount, stripePriceIds: priceIds(...ids) };
}

/**
 * Pure builder kept public so catalog invariants can be tested with synthetic
 * Price IDs rather than depending on a developer's `.env`.
 */
export function buildBillingCatalog(
  env: BillingCatalogEnvironment
): readonly BillingProduct[] {
  const products: BillingProduct[] = [
    {
      id: "plus-monthly",
      legacyIds: ["launch-monthly"],
      name: "Plus Monthly",
      tier: "plus",
      interval: "month",
      validMonths: 1,
      credits: PLAN_MONTHLY_CREDITS.plus,
      prices: {
        usd: price(
          "usd",
          2_900,
          env.STRIPE_PRICE_PLUS_MONTHLY,
          env.NEXT_PUBLIC_STRIPE_PRICE_PLUS_MONTHLY,
          env.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY
        ),
        cny: price(
          "cny",
          19_900,
          env.STRIPE_PRICE_PLUS_MONTHLY_CNY,
          env.NEXT_PUBLIC_STRIPE_PRICE_PLUS_MONTHLY_CNY,
          env.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY_CNY
        ),
      },
    },
    {
      id: "max-monthly",
      legacyIds: ["scale-monthly"],
      name: "Max Monthly",
      tier: "max",
      interval: "month",
      validMonths: 1,
      credits: PLAN_MONTHLY_CREDITS.max,
      prices: {
        usd: price(
          "usd",
          7_900,
          env.STRIPE_PRICE_MAX_MONTHLY,
          env.NEXT_PUBLIC_STRIPE_PRICE_MAX_MONTHLY,
          env.NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY
        ),
        cny: price(
          "cny",
          54_900,
          env.STRIPE_PRICE_MAX_MONTHLY_CNY,
          env.NEXT_PUBLIC_STRIPE_PRICE_MAX_MONTHLY_CNY,
          env.NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY_CNY
        ),
      },
    },
    {
      id: "plus-yearly",
      legacyIds: ["launch-yearly"],
      name: "Plus Yearly",
      tier: "plus",
      interval: "year",
      validMonths: 12,
      credits: PLAN_MONTHLY_CREDITS.plus * 12,
      prices: {
        usd: price(
          "usd",
          29_900,
          env.STRIPE_PRICE_PLUS_YEARLY,
          env.NEXT_PUBLIC_STRIPE_PRICE_PLUS_YEARLY,
          env.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY
        ),
        cny: price(
          "cny",
          208_800,
          env.STRIPE_PRICE_PLUS_YEARLY_CNY,
          env.NEXT_PUBLIC_STRIPE_PRICE_PLUS_YEARLY_CNY,
          env.NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY_CNY
        ),
      },
    },
    {
      id: "max-yearly",
      legacyIds: ["scale-yearly"],
      name: "Max Yearly",
      tier: "max",
      interval: "year",
      validMonths: 12,
      credits: PLAN_MONTHLY_CREDITS.max * 12,
      prices: {
        usd: price(
          "usd",
          79_900,
          env.STRIPE_PRICE_MAX_YEARLY,
          env.NEXT_PUBLIC_STRIPE_PRICE_MAX_YEARLY,
          env.NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY
        ),
        cny: price(
          "cny",
          551_900,
          env.STRIPE_PRICE_MAX_YEARLY_CNY,
          env.NEXT_PUBLIC_STRIPE_PRICE_MAX_YEARLY_CNY,
          env.NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY_CNY
        ),
      },
    },
  ];

  // A duplicate across intervals is particularly dangerous: a renewal would
  // have two possible credit grants. Refuse the configuration at module load.
  const ownerByPriceId = new Map<string, string>();
  for (const product of products) {
    for (const price of Object.values(product.prices)) {
      if (!price) continue;
      for (const priceId of price.stripePriceIds) {
        const owner = `${product.id}:${price.currency}`;
        const existing = ownerByPriceId.get(priceId);
        if (existing && existing !== owner) {
          throw new Error(
            `stripe price ${priceId} is claimed by both "${existing}" and "${owner}" in src/config/billing.ts`
          );
        }
        ownerByPriceId.set(priceId, owner);
      }
    }
  }

  return products;
}

// Pass the environment object into the pure builder rather than spelling
// `process.env.NEXT_PUBLIC_*` here. Direct NEXT_PUBLIC access is replaced by
// Next at build time; aliasing the object keeps legacy values runtime-readable
// for existing deployments while new setups use server-only STRIPE_PRICE_*.
export const BILLING_PRODUCTS = buildBillingCatalog(process.env);

export function billingPriceIdsForTier(tier: PaidTier): readonly string[] {
  return [
    ...new Set(
      BILLING_PRODUCTS.filter((product) => product.tier === tier).flatMap(
        (product) =>
          Object.values(product.prices).flatMap(
            (price) => price?.stripePriceIds ?? []
          )
      )
    ),
  ];
}
