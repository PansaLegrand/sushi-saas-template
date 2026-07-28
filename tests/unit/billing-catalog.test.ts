/**
 * Commercial catalog invariants.
 *
 * Checkout, subscription entitlements, and renewal grants all read this same
 * data. These tests focus on the drift that is expensive in production: a
 * yearly plan granting a monthly amount, an old Price ID becoming unmappable,
 * or one Stripe Price pointing at two different grants.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PLAN_MONTHLY_CREDITS,
  buildBillingCatalog,
} from "@/config/billing";

const ENV = {
  STRIPE_PRICE_PLUS_MONTHLY: "price_1PlusMonth",
  STRIPE_PRICE_PLUS_YEARLY: "price_1PlusYear",
  STRIPE_PRICE_MAX_MONTHLY: "price_1MaxMonth",
  STRIPE_PRICE_MAX_YEARLY: "price_1MaxYear",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("billing catalog", () => {
  it("derives every recurring grant from the tier's monthly allowance", () => {
    const catalog = buildBillingCatalog(ENV);

    for (const product of catalog) {
      const periods = product.interval === "year" ? 12 : 1;
      expect(product.credits).toBe(
        PLAN_MONTHLY_CREDITS[product.tier] * periods
      );
      expect(product.validMonths).toBe(periods);
    }
  });

  it("keeps legacy product and Stripe Price IDs mappable", () => {
    const catalog = buildBillingCatalog({
      ...ENV,
      NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY: "price_1OldPlusMonth",
    });
    const plusMonthly = catalog.find(
      (product) => product.id === "plus-monthly"
    );

    expect(plusMonthly?.legacyIds).toContain("launch-monthly");
    expect(plusMonthly?.prices.usd?.stripePriceIds).toEqual([
      "price_1PlusMonth",
      "price_1OldPlusMonth",
    ]);
  });

  it("refuses one Stripe Price mapped to two billing periods", () => {
    expect(() =>
      buildBillingCatalog({
        ...ENV,
        STRIPE_PRICE_PLUS_YEARLY: "price_1PlusMonth",
      })
    ).toThrow(/claimed by both/);
  });

  it("uses the same mapping for checkout aliases and Stripe renewals", async () => {
    vi.stubEnv(
      "STRIPE_PRICE_PLUS_MONTHLY",
      "price_1CheckoutAndRenewal"
    );
    vi.resetModules();
    const {
      findBillingProductByPriceId,
      findPurchasableBillingProduct,
    } = await import("@/services/billing-catalog");

    const checkout = findPurchasableBillingProduct("launch-monthly", "usd");
    const renewal = findBillingProductByPriceId(
      "price_1CheckoutAndRenewal"
    );

    expect(checkout?.product.id).toBe("plus-monthly");
    expect(checkout?.stripePriceId).toBe("price_1CheckoutAndRenewal");
    expect(renewal?.product.id).toBe("plus-monthly");
    expect(renewal?.product.credits).toBe(PLAN_MONTHLY_CREDITS.plus);
  });
});
