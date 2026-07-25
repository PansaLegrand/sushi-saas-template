/**
 * Syncing Stripe subscriptions into our own table.
 *
 * Two failures this covers are the expensive kind, because both are silent: a
 * subscription that cannot be attributed to a user (a paying customer with no
 * access), and one whose price is not in the catalog (the same, with an
 * additional temptation to guess). Neither may be swallowed.
 *
 * The upsert itself — including the out-of-order guard — is covered against
 * real Postgres in `tests/db/subscriptions.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  upsertStripeSubscription: vi.fn(),
  findUserByStripeCustomerId: vi.fn(),
  getUserUuidsByEmail: vi.fn(),
  notifySlackError: vi.fn(),
  tierForPriceIds: vi.fn(),
}));

vi.mock("@/models/subscription", async () => {
  const actual = await vi.importActual<typeof import("@/models/subscription")>(
    "@/models/subscription"
  );
  return { ...actual, upsertStripeSubscription: mocks.upsertStripeSubscription };
});

vi.mock("@/models/user", () => ({
  findUserByStripeCustomerId: mocks.findUserByStripeCustomerId,
  getUserUuidsByEmail: mocks.getUserUuidsByEmail,
}));

vi.mock("@/integrations/slack", () => ({
  notifySlackError: mocks.notifySlackError,
}));

vi.mock("@/services/entitlements", async () => {
  const actual = await vi.importActual<typeof import("@/services/entitlements")>(
    "@/services/entitlements"
  );
  return { ...actual, tierForPriceIds: mocks.tierForPriceIds };
});

import { syncStripeSubscription } from "@/services/subscriptions";

const EVENT_AT = new Date("2026-03-01T12:00:00.000Z");

function stripeSubscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    current_period_start: 1_772_000_000,
    current_period_end: 1_774_000_000,
    trial_end: null,
    ended_at: null,
    metadata: { user_uuid: "u-1" },
    items: { data: [{ price: { id: "price_plus_monthly" } }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsertStripeSubscription.mockResolvedValue({ applied: true, row: { uuid: "row-1" } });
  mocks.tierForPriceIds.mockReturnValue("plus");
});

describe("syncStripeSubscription", () => {
  it("copies the Stripe object into a row", async () => {
    const outcome = await syncStripeSubscription(stripeSubscription(), EVENT_AT);

    expect(outcome).toMatchObject({ status: "applied", tier: "plus" });
    expect(mocks.upsertStripeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        user_uuid: "u-1",
        stripe_subscription_id: "sub_1",
        stripe_customer_id: "cus_1",
        tier: "plus",
        status: "active",
        stripe_event_at: EVENT_AT,
        current_period_end: new Date(1_774_000_000 * 1000),
      })
    );
  });

  it("carries a cancellation through as ordinary state", async () => {
    // `customer.subscription.deleted` is not a special path: it is an object
    // whose status is now "canceled". One code path, no transition logic of
    // our own to disagree with Stripe's.
    await syncStripeSubscription(
      stripeSubscription({ status: "canceled", ended_at: 1_774_000_100 }),
      EVENT_AT
    );

    expect(mocks.upsertStripeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "canceled",
        ended_at: new Date(1_774_000_100 * 1000),
      })
    );
  });

  it("reads the period from the subscription item when the top level is absent", async () => {
    // Stripe has been moving these fields onto items; which one is populated
    // depends on the account's pinned API version.
    await syncStripeSubscription(
      stripeSubscription({
        current_period_start: undefined,
        current_period_end: undefined,
        items: {
          data: [
            {
              price: { id: "price_plus_monthly" },
              current_period_start: 1_772_000_000,
              current_period_end: 1_774_000_000,
            },
          ],
        },
      }),
      EVENT_AT
    );

    expect(mocks.upsertStripeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ current_period_end: new Date(1_774_000_000 * 1000) })
    );
  });

  it("falls back to the stored Stripe customer id", async () => {
    // Subscriptions created from the Stripe dashboard carry no metadata of ours.
    mocks.findUserByStripeCustomerId.mockResolvedValue({ uuid: "u-from-customer" });

    await syncStripeSubscription(stripeSubscription({ metadata: {} }), EVENT_AT);

    expect(mocks.upsertStripeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ user_uuid: "u-from-customer" })
    );
  });

  it("uses the customer email only when it identifies exactly one account", async () => {
    mocks.findUserByStripeCustomerId.mockResolvedValue(undefined);
    // An address can be shared across sign-in providers, so two matches
    // identify nobody.
    mocks.getUserUuidsByEmail.mockResolvedValue(["u-a", "u-b"]);

    const outcome = await syncStripeSubscription(
      stripeSubscription({
        metadata: {},
        customer: { id: "cus_1", email: "shared@example.com" },
      }),
      EVENT_AT
    );

    expect(outcome).toEqual({ status: "unmapped", reason: "no-user" });
    expect(mocks.upsertStripeSubscription).not.toHaveBeenCalled();
  });

  it("raises an alert rather than dropping an unattributable subscription", async () => {
    mocks.findUserByStripeCustomerId.mockResolvedValue(undefined);
    mocks.getUserUuidsByEmail.mockResolvedValue([]);

    const outcome = await syncStripeSubscription(
      stripeSubscription({ metadata: {} }),
      EVENT_AT
    );

    expect(outcome).toEqual({ status: "unmapped", reason: "no-user" });
    expect(mocks.notifySlackError).toHaveBeenCalled();
  });

  it("refuses to guess a tier for a price outside the catalog", async () => {
    // Someone created a price in the Stripe dashboard and did not add it to
    // src/config/plans.ts. Granting a guessed tier would be worse than saying so.
    mocks.tierForPriceIds.mockReturnValue(undefined);

    const outcome = await syncStripeSubscription(stripeSubscription(), EVENT_AT);

    expect(outcome).toEqual({ status: "unmapped", reason: "no-tier" });
    expect(mocks.upsertStripeSubscription).not.toHaveBeenCalled();
    expect(mocks.notifySlackError).toHaveBeenCalled();
  });

  it("reports a dropped stale event as success, not failure", async () => {
    // The row already holds a newer event. That is the outcome we want, so the
    // webhook must acknowledge rather than let Stripe retry forever.
    mocks.upsertStripeSubscription.mockResolvedValue({ applied: false });

    expect(await syncStripeSubscription(stripeSubscription(), EVENT_AT)).toEqual({
      status: "stale",
    });
  });
});
