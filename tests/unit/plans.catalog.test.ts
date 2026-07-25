/**
 * The plan catalog's own invariants.
 *
 * `src/config/plans.ts` is the file a clone edits, which makes it the file most
 * likely to be edited in a hurry by someone who has never read the rest of this
 * repo. TypeScript already refuses a tier that omits a feature; these are the
 * mistakes the type system cannot see — a duplicated rank, a price ID pasted
 * under two tiers, a free plan that accidentally outranks a paid one.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIER,
  PLANS,
  PLAN_FEATURES,
  PLAN_LIMITS,
  PLAN_TIERS,
  isTier,
  planFor,
  tierForPriceId,
} from "@/config/plans";

describe("plan catalog", () => {
  it("lists every tier it defines", () => {
    // Guards the guard: PLAN_TIERS drives the tests below, so a tier missing
    // from it would be silently exempt from all of them.
    expect([...PLAN_TIERS].sort()).toEqual(Object.keys(PLANS).sort());
  });

  it("gives every tier a distinct rank", () => {
    const ranks = PLAN_TIERS.map((tier) => planFor(tier).rank);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("starts the ladder at the default tier", () => {
    // The tier a user gets for free must be the cheapest one, or `resolvePlan`
    // would hand an unpaid account something better than a paid one.
    const lowest = PLAN_TIERS.reduce((a, b) =>
      planFor(a).rank <= planFor(b).rank ? a : b
    );

    expect(lowest).toBe(DEFAULT_TIER);
    expect(planFor(DEFAULT_TIER).priceIds).toEqual([]);
  });

  it("declares every feature and limit on every tier", () => {
    for (const tier of PLAN_TIERS) {
      const plan = planFor(tier);

      expect(Object.keys(plan.features).sort()).toEqual([...PLAN_FEATURES].sort());
      expect(Object.keys(plan.limits).sort()).toEqual([...PLAN_LIMITS].sort());
    }
  });

  it("uses null rather than a sentinel number for unlimited", () => {
    // A limit of 0 means "none allowed" and -1 means nothing at all. Both have
    // been used as "unlimited" in other codebases, and both eventually let
    // someone through a check that was meant to stop them.
    for (const tier of PLAN_TIERS) {
      for (const value of Object.values(planFor(tier).limits)) {
        expect(value === null || (typeof value === "number" && value >= 0)).toBe(true);
      }
    }
  });

  it("never gives a lower tier more than a higher one", () => {
    // Not a law of nature — a product could sell a cheap tier with more
    // storage — but here it is always a mistake, and it is invisible in review.
    const ordered = [...PLAN_TIERS].sort((a, b) => planFor(a).rank - planFor(b).rank);

    for (let i = 1; i < ordered.length; i += 1) {
      const lower = planFor(ordered[i - 1]);
      const higher = planFor(ordered[i]);

      for (const feature of PLAN_FEATURES) {
        if (lower.features[feature]) {
          expect(
            higher.features[feature],
            `${ordered[i]} lost feature "${feature}" that ${ordered[i - 1]} has`
          ).toBe(true);
        }
      }

      for (const limit of PLAN_LIMITS) {
        const lowerValue = lower.limits[limit];
        const higherValue = higher.limits[limit];
        if (lowerValue === null) {
          expect(
            higherValue,
            `${ordered[i]} caps "${limit}" that ${ordered[i - 1]} leaves unlimited`
          ).toBeNull();
          continue;
        }
        if (higherValue === null) continue;
        expect(
          higherValue,
          `${ordered[i]} allows less "${limit}" than ${ordered[i - 1]}`
        ).toBeGreaterThanOrEqual(lowerValue);
      }
    }
  });

  it("resolves a configured price to its tier and ignores anything else", () => {
    expect(tierForPriceId("price_not_ours")).toBeUndefined();
    expect(tierForPriceId(null)).toBeUndefined();
    expect(tierForPriceId(undefined)).toBeUndefined();

    for (const tier of PLAN_TIERS) {
      for (const priceId of planFor(tier).priceIds) {
        expect(tierForPriceId(priceId)).toBe(tier);
      }
    }
  });

  it("narrows arbitrary strings to known tiers", () => {
    // `subscriptions.tier` is a varchar. A row written by an older deploy can
    // name a tier that no longer exists, and it must not resolve to anything.
    expect(isTier("free")).toBe(true);
    expect(isTier("enterprise")).toBe(false);
    expect(isTier(null)).toBe(false);
  });
});
