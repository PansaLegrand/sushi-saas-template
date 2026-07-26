/**
 * Database tier: subscription upserts.
 *
 * The whole correctness of the billing sync rests on one statement — an
 * `INSERT ... ON CONFLICT DO UPDATE ... WHERE` whose `WHERE` compares event
 * timestamps. That clause is unreachable from a mocked test: it is Postgres
 * that decides whether the update fires, using the `excluded` pseudo-row.
 *
 * What it prevents is worth stating plainly. Stripe retries failed webhook
 * deliveries for days, so events arrive out of order. Without the guard, a
 * delayed `customer.subscription.updated` landing after the `deleted` that
 * followed it re-activates a cancelled subscription — the user keeps a paid
 * tier they no longer pay for, and nothing in the logs looks wrong.
 */
import { expect, it } from "vitest";

import { describeDb, useCleanDatabase } from "./setup";

import {
  SubscriptionSource,
  SubscriptionStatus,
  endSubscription,
  findSubscriptionByStripeId,
  insertManualSubscription,
  listSubscriptionsByOrg,
  upsertStripeSubscription,
} from "@/models/subscription";

const STRIPE_SUB_ID = "sub_stripe_test";

function baseInput(overrides: Partial<Parameters<typeof upsertStripeSubscription>[0]> = {}) {
  return {
    uuid: `uuid-${Math.random().toString(36).slice(2)}`,
    // The plan belongs to the org; the user is recorded for attribution only.
    org_uuid: "org-1",
    user_uuid: "u-1",
    stripe_subscription_id: STRIPE_SUB_ID,
    stripe_customer_id: "cus_1",
    stripe_price_id: "price_1",
    tier: "plus",
    status: SubscriptionStatus.Active,
    current_period_start: new Date("2026-01-01T00:00:00.000Z"),
    current_period_end: new Date("2026-02-01T00:00:00.000Z"),
    cancel_at_period_end: false,
    stripe_event_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describeDb("subscriptions", () => {
  useCleanDatabase();

  it("inserts a subscription the first time it is seen", async () => {
    const { applied, row } = await upsertStripeSubscription(baseInput());

    expect(applied).toBe(true);
    expect(row?.tier).toBe("plus");
    expect(row?.source).toBe(SubscriptionSource.Stripe);
  });

  it("keeps one row per Stripe subscription across redeliveries", async () => {
    const input = baseInput();

    await upsertStripeSubscription(input);
    await upsertStripeSubscription({ ...input, uuid: "uuid-second" });

    const rows = await listSubscriptionsByOrg("org-1");
    expect(rows).toHaveLength(1);
    // The row keeps the identity it was created with — a redelivery must not
    // hand it a new uuid that other tables might already reference.
    expect(rows[0].uuid).toBe(input.uuid);
  });

  it("applies a newer event", async () => {
    await upsertStripeSubscription(baseInput());

    const { applied } = await upsertStripeSubscription(
      baseInput({
        status: SubscriptionStatus.Canceled,
        stripe_event_at: new Date("2026-01-05T00:00:00.000Z"),
      })
    );

    expect(applied).toBe(true);
    expect((await findSubscriptionByStripeId(STRIPE_SUB_ID))?.status).toBe(
      SubscriptionStatus.Canceled
    );
  });

  it("drops an event older than the state already stored", async () => {
    // The scenario in the file header: cancellation processed first, then a
    // stale update arrives from Stripe's retry queue.
    await upsertStripeSubscription(
      baseInput({
        status: SubscriptionStatus.Canceled,
        stripe_event_at: new Date("2026-01-05T00:00:00.000Z"),
      })
    );

    const { applied } = await upsertStripeSubscription(
      baseInput({
        status: SubscriptionStatus.Active,
        stripe_event_at: new Date("2026-01-01T00:00:00.000Z"),
      })
    );

    expect(applied).toBe(false);
    expect((await findSubscriptionByStripeId(STRIPE_SUB_ID))?.status).toBe(
      SubscriptionStatus.Canceled
    );
  });

  it("applies an event with the same timestamp", async () => {
    // Two events inside the same second are ordinary — a plan change emits
    // several. Dropping equal timestamps would lose the last write.
    const at = new Date("2026-01-03T00:00:00.000Z");

    await upsertStripeSubscription(baseInput({ stripe_event_at: at }));
    const { applied } = await upsertStripeSubscription(
      baseInput({ tier: "max", stripe_event_at: at })
    );

    expect(applied).toBe(true);
    expect((await findSubscriptionByStripeId(STRIPE_SUB_ID))?.tier).toBe("max");
  });

  it("filters by status so cancelled rows stay out of the read path", async () => {
    await upsertStripeSubscription(baseInput({ status: SubscriptionStatus.Canceled }));

    expect(
      await listSubscriptionsByOrg("org-1", {
        statuses: [SubscriptionStatus.Active, SubscriptionStatus.Trialing],
      })
    ).toHaveLength(0);
    expect(await listSubscriptionsByOrg("org-1")).toHaveLength(1);
  });

  it("stores a comped subscription with no Stripe id", async () => {
    // The unique index is on a nullable column: Postgres allows many NULLs, so
    // comps do not collide with each other.
    await insertManualSubscription({
      uuid: "comp-1",
      org_uuid: "org-2",
      user_uuid: "u-2",
      tier: "max",
      status: SubscriptionStatus.Active,
      note: "design partner",
    });
    await insertManualSubscription({
      uuid: "comp-2",
      org_uuid: "org-3",
      user_uuid: "u-3",
      tier: "max",
      status: SubscriptionStatus.Active,
    });

    expect(await listSubscriptionsByOrg("org-2")).toHaveLength(1);
    expect(await listSubscriptionsByOrg("org-3")).toHaveLength(1);
  });

  it("ends a subscription without deleting the record", async () => {
    await insertManualSubscription({
      uuid: "comp-1",
      org_uuid: "org-2",
      user_uuid: "u-2",
      tier: "max",
      status: SubscriptionStatus.Active,
    });

    const ended = await endSubscription("comp-1");

    expect(ended?.status).toBe(SubscriptionStatus.Canceled);
    expect(ended?.ended_at).toBeInstanceOf(Date);
    expect(await listSubscriptionsByOrg("org-2")).toHaveLength(1);
  });
});
