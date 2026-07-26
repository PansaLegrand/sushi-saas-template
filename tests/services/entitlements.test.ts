/**
 * The entitlement service: who may do what, and for how long.
 *
 * Every assertion here is about money. A bug in `isEntitling` either hands a
 * paid feature to someone who stopped paying, or locks out someone whose card
 * is merely being retried — and neither shows up in a type check. The
 * subscription model is mocked so the *rules* are what is under test; the SQL
 * behind them is covered by `tests/db/subscriptions.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PAST_DUE_GRACE_DAYS } from "@/config/plans";

const listSubscriptionsByOrg = vi.fn();

vi.mock("@/models/subscription", async () => {
  const actual = await vi.importActual<typeof import("@/models/subscription")>(
    "@/models/subscription"
  );

  return {
    ...actual,
    // Only the read path is mocked: the status constants stay real, so a typo
    // in a status string fails here rather than passing against a fake.
    listSubscriptionsByOrg: (...args: unknown[]) =>
      listSubscriptionsByOrg(...args),
  };
});

import {
  can,
  enforceLimit,
  getPlanSnapshot,
  isEntitling,
  isWithinLimit,
  limitOf,
  lowestTierWith,
  requireEntitlement,
  resolvePlan,
  tierForPriceIds,
} from "@/services/entitlements";
import { SubscriptionStatus, type SubscriptionRow } from "@/models/subscription";
import { asOrgUuid } from "@/models/organization";

/**
 * The subject of an entitlement is an organization, not a person. Branded so
 * that passing a user uuid here is a compile error rather than a silent
 * free-tier answer.
 */
const ORG = asOrgUuid("org-1");

const DAY_MS = 24 * 60 * 60 * 1000;

function row(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  const now = new Date();

  return {
    id: 1,
    uuid: "sub-1",
    org_uuid: "org-1",
    user_uuid: "u-1",
    stripe_subscription_id: "sub_stripe_1",
    stripe_customer_id: "cus_1",
    stripe_price_id: "price_1",
    tier: "plus",
    status: SubscriptionStatus.Active,
    source: "stripe",
    current_period_start: new Date(now.getTime() - 5 * DAY_MS),
    current_period_end: new Date(now.getTime() + 25 * DAY_MS),
    trial_end: null,
    cancel_at_period_end: false,
    ended_at: null,
    stripe_event_at: now,
    note: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  } as SubscriptionRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  listSubscriptionsByOrg.mockResolvedValue([]);
});

describe("resolvePlan", () => {
  it("puts a user with no subscription on the free tier", async () => {
    const resolved = await resolvePlan(ORG);

    expect(resolved.tier).toBe("free");
    expect(resolved.subscription).toBeNull();
  });

  it("puts a signed-out visitor on the free tier without querying", async () => {
    const resolved = await resolvePlan(null);

    expect(resolved.tier).toBe("free");
    expect(listSubscriptionsByOrg).not.toHaveBeenCalled();
  });

  it("grants the tier of an active subscription", async () => {
    listSubscriptionsByOrg.mockResolvedValue([row({ tier: "plus" })]);

    expect((await resolvePlan(ORG)).tier).toBe("plus");
  });

  it("keeps access for a subscription cancelled at period end", async () => {
    // The user already paid for the rest of the period. Cutting them off the
    // moment they click cancel is taking money for nothing.
    listSubscriptionsByOrg.mockResolvedValue([
      row({ tier: "max", cancel_at_period_end: true }),
    ]);

    expect((await resolvePlan(ORG)).tier).toBe("max");
  });

  it("drops a subscription whose period has ended", async () => {
    listSubscriptionsByOrg.mockResolvedValue([
      row({ tier: "max", current_period_end: new Date(Date.now() - DAY_MS) }),
    ]);

    expect((await resolvePlan(ORG)).tier).toBe("free");
  });

  it("takes the highest tier when a user holds more than one", async () => {
    // A comped Max alongside a paid Plus is a real situation. Taking the most
    // recently updated row instead of the best one would silently downgrade.
    listSubscriptionsByOrg.mockResolvedValue([
      row({ uuid: "sub-plus", tier: "plus" }),
      row({ uuid: "sub-max", tier: "max", source: "manual", stripe_subscription_id: null }),
    ]);

    const resolved = await resolvePlan(ORG);

    expect(resolved.tier).toBe("max");
    expect(resolved.subscription?.uuid).toBe("sub-max");
  });

  it("ignores a tier that is no longer in the catalog", async () => {
    // Written by a previous deploy, or by a tier that was renamed. It must not
    // resolve to anything rather than crash or fall through to a guess.
    listSubscriptionsByOrg.mockResolvedValue([row({ tier: "enterprise" })]);

    expect((await resolvePlan(ORG)).tier).toBe("free");
  });

  it("honours a comp with no end date", async () => {
    listSubscriptionsByOrg.mockResolvedValue([
      row({ tier: "max", source: "manual", current_period_end: null }),
    ]);

    expect((await resolvePlan(ORG)).tier).toBe("max");
  });
});

describe("isEntitling", () => {
  it("entitles active and trialing subscriptions", () => {
    expect(isEntitling(row({ status: SubscriptionStatus.Active }))).toBe(true);
    expect(isEntitling(row({ status: SubscriptionStatus.Trialing }))).toBe(true);
  });

  it("never entitles a canceled or unpaid subscription", () => {
    for (const status of [
      SubscriptionStatus.Canceled,
      SubscriptionStatus.Unpaid,
      SubscriptionStatus.Incomplete,
      SubscriptionStatus.IncompleteExpired,
      SubscriptionStatus.Paused,
    ]) {
      expect(isEntitling(row({ status })), status).toBe(false);
    }
  });

  it("keeps a past_due subscription alive for the grace period", () => {
    const now = new Date();
    const endedYesterday = new Date(now.getTime() - DAY_MS);

    expect(
      isEntitling(
        row({ status: SubscriptionStatus.PastDue, current_period_end: endedYesterday }),
        now
      )
    ).toBe(true);
  });

  it("drops a past_due subscription once the grace period expires", () => {
    const now = new Date();
    const longAgo = new Date(now.getTime() - (PAST_DUE_GRACE_DAYS + 1) * DAY_MS);

    expect(
      isEntitling(
        row({ status: SubscriptionStatus.PastDue, current_period_end: longAgo }),
        now
      )
    ).toBe(false);
  });

  it("drops any subscription that has already ended", () => {
    const now = new Date();

    expect(
      isEntitling(row({ ended_at: new Date(now.getTime() - 1000) }), now)
    ).toBe(false);
  });
});

describe("features", () => {
  it("answers from the resolved plan", async () => {
    expect(await can(ORG, "tasks.text_to_video")).toBe(false);

    listSubscriptionsByOrg.mockResolvedValue([row({ tier: "plus" })]);
    expect(await can(ORG, "tasks.text_to_video")).toBe(true);
  });

  it("throws a catalogued, upgrade-shaped error when a feature is missing", async () => {
    await expect(requireEntitlement(ORG, "tasks.text_to_video")).rejects.toMatchObject({
      code: "PLAN_UPGRADE_REQUIRED",
      statusCode: 403,
      details: {
        feature: "tasks.text_to_video",
        tier: "free",
        // The client renders "available on Plus" from this rather than owning
        // a second copy of the catalog.
        requiredTier: "plus",
      },
    });
  });

  it("returns rather than throws when the feature is included", async () => {
    listSubscriptionsByOrg.mockResolvedValue([row({ tier: "max" })]);

    await expect(requireEntitlement(ORG, "tasks.text_to_video")).resolves.toMatchObject({
      tier: "max",
    });
  });

  it("names the cheapest tier that includes a feature", () => {
    expect(lowestTierWith("tasks.text_to_video")).toBe("plus");
    expect(lowestTierWith("storage.upload")).toBe("free");
  });
});

describe("limits", () => {
  it("treats null as unlimited", () => {
    expect(isWithinLimit(null, { current: 1_000_000, adding: 1 })).toBe(true);
  });

  it("counts the pending request, not just what is already used", () => {
    // Off-by-one here is the difference between a limit of 3 meaning three and
    // meaning four.
    expect(isWithinLimit(3, { current: 2, adding: 1 })).toBe(true);
    expect(isWithinLimit(3, { current: 3, adding: 1 })).toBe(false);
    expect(isWithinLimit(3, { current: 0, adding: 4 })).toBe(false);
  });

  it("defaults `adding` to one", () => {
    expect(isWithinLimit(1, { current: 0 })).toBe(true);
    expect(isWithinLimit(1, { current: 1 })).toBe(false);
  });

  it("reads the cap from the resolved plan", async () => {
    expect(await limitOf(ORG, "storage.maxFileMb")).toBe(5);

    listSubscriptionsByOrg.mockResolvedValue([row({ tier: "max" })]);
    expect(await limitOf(ORG, "tasks.perMonth")).toBeNull();
  });

  it("throws with the numbers needed to explain itself", async () => {
    await expect(
      enforceLimit(ORG, "storage.totalMb", { current: 100, adding: 10 })
    ).rejects.toMatchObject({
      code: "PLAN_LIMIT_EXCEEDED",
      statusCode: 403,
      details: { limit: "storage.totalMb", tier: "free", max: 100, current: 100 },
    });
  });

  it("allows a request that exactly reaches the cap", async () => {
    await expect(
      enforceLimit(ORG, "storage.totalMb", { current: 90, adding: 10 })
    ).resolves.toBeUndefined();
  });
});

describe("getPlanSnapshot", () => {
  it("serializes the free plan with no subscription", async () => {
    const snapshot = await getPlanSnapshot(ORG);

    expect(snapshot).toMatchObject({ tier: "free", subscription: null });
    expect(snapshot.features["storage.upload"]).toBe(true);
  });

  it("serializes dates as ISO strings so the payload survives JSON", async () => {
    const periodEnd = new Date(Date.now() + 10 * DAY_MS);
    listSubscriptionsByOrg.mockResolvedValue([
      row({ tier: "plus", current_period_end: periodEnd, cancel_at_period_end: true }),
    ]);

    const snapshot = await getPlanSnapshot(ORG);

    expect(snapshot.subscription).toEqual({
      status: "active",
      currentPeriodEnd: periodEnd.toISOString(),
      cancelAtPeriodEnd: true,
      source: "stripe",
    });
    // Round-trips without losing a limit — the reason `null` is the unlimited
    // sentinel rather than Infinity.
    expect(JSON.parse(JSON.stringify(snapshot)).limits).toEqual(snapshot.limits);
  });
});

describe("tierForPriceIds", () => {
  it("ignores prices that are not in the catalog", () => {
    expect(tierForPriceIds(["price_unknown", null, undefined])).toBeUndefined();
  });
});
