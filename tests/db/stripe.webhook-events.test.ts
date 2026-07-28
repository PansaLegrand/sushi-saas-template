/**
 * Database tier: the webhook event table, as an idempotency guard and as a
 * receipt.
 *
 * Two things here only exist in the database:
 *
 *   1. `event_id` is UNIQUE, and `claimStripeWebhookEvent` is a
 *      claim-or-report-who-holds-it built on that constraint. The route's
 *      "skip a completed event" and "409 a concurrent one" behaviour is that
 *      insert conflicting. A mock returns whatever it was told to.
 *   2. The denormalized receipt columns are indexed so "every event for this
 *      subscription" is a lookup. Asserting the columns are *written* is only
 *      half of it — this queries by them, which is what they are for.
 */
import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { stripeWebhookEvents } from "@/db/schema";
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventActionRequired,
  markStripeWebhookEventCompleted,
  markStripeWebhookEventFailed,
  listStripeWebhookEvents,
} from "@/models/stripe-webhook-event";
import { extractWebhookReceipt } from "@/services/stripe/receipt";

function invoicePaidEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_invoice_1",
    type: "invoice.payment_succeeded",
    api_version: "2025-01-01",
    livemode: true,
    created: 1767225600,
    request: { id: "req_9", idempotency_key: null },
    data: {
      object: {
        object: "invoice",
        id: "in_100",
        customer: "cus_100",
        subscription: "sub_100",
      },
    },
    ...overrides,
  } as never;
}

async function rowFor(eventId: string) {
  const [row] = await db()
    .select()
    .from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.event_id, eventId))
    .limit(1);
  return row;
}

async function claim(event: ReturnType<typeof invoicePaidEvent>) {
  const e = event as unknown as { id: string; type: string };
  return claimStripeWebhookEvent({
    eventId: e.id,
    eventType: e.type,
    payload: JSON.stringify(event),
    receipt: extractWebhookReceipt(event),
  });
}

describeDb("stripe webhook events (real database)", () => {
  useCleanDatabase();

  it("claims a new event and stores its receipt alongside the payload", async () => {
    expect(await claim(invoicePaidEvent())).toBe("claimed");

    const row = await rowFor("evt_invoice_1");

    expect(row).toMatchObject({
      event_type: "invoice.payment_succeeded",
      status: "processing",
      attempts: 1,
      stripe_object_id: "in_100",
      stripe_customer_id: "cus_100",
      stripe_invoice_id: "in_100",
      stripe_subscription_id: "sub_100",
      livemode: true,
      api_version: "2025-01-01",
      request_id: "req_9",
    });
    // The payload is still the record of truth; the columns are an index over it.
    expect(JSON.parse(row!.payload!).data.object.id).toBe("in_100");
  });

  it("finds every event for one subscription without reading payloads", async () => {
    // The query the columns exist for. Against `payload` alone this is a full
    // scan plus a JSON parse per row.
    await claim(invoicePaidEvent());
    await claim(
      invoicePaidEvent({
        id: "evt_invoice_2",
        data: {
          object: {
            object: "invoice",
            id: "in_101",
            customer: "cus_100",
            subscription: "sub_100",
          },
        },
      })
    );
    await claim(
      invoicePaidEvent({
        id: "evt_other_sub",
        data: {
          object: {
            object: "invoice",
            id: "in_200",
            customer: "cus_200",
            subscription: "sub_999",
          },
        },
      })
    );

    const forSubscription = await db()
      .select()
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.stripe_subscription_id, "sub_100"));

    expect(forSubscription.map((row) => row.event_id).sort()).toEqual([
      "evt_invoice_1",
      "evt_invoice_2",
    ]);
  });

  it("finds the events for one invoice, which is what reconciliation walks", async () => {
    await claim(invoicePaidEvent());

    const [row] = await db()
      .select()
      .from(stripeWebhookEvents)
      .where(
        and(
          eq(stripeWebhookEvents.stripe_invoice_id, "in_100"),
          eq(stripeWebhookEvents.status, "processing")
        )
      );

    expect(row?.event_id).toBe("evt_invoice_1");
  });

  it("reports a completed event as completed rather than reclaiming it", async () => {
    await claim(invoicePaidEvent());
    await markStripeWebhookEventCompleted("evt_invoice_1");

    expect(await claim(invoicePaidEvent())).toBe("completed");

    const row = await rowFor("evt_invoice_1");
    expect(row?.attempts).toBe(1);
    expect(row?.processed_at).not.toBeNull();
  });

  it("reports a concurrent delivery as processing", async () => {
    await claim(invoicePaidEvent());

    // Still inside the stale window, so the second delivery must not proceed.
    expect(await claim(invoicePaidEvent())).toBe("processing");
  });

  it("reclaims a failed event and refreshes its receipt with the payload", async () => {
    // A row claimed before migration 0019 has nulls in the receipt columns, and
    // a retry is its only chance to fill them. Leaving them stale would let the
    // receipt and the payload it came from disagree — which is worse than a null,
    // because a null is visibly absent.
    await claim(invoicePaidEvent());
    await db()
      .update(stripeWebhookEvents)
      .set({
        stripe_subscription_id: null,
        stripe_customer_id: null,
        request_id: null,
      })
      .where(eq(stripeWebhookEvents.event_id, "evt_invoice_1"));
    await markStripeWebhookEventFailed("evt_invoice_1", new Error("boom"));

    expect(await claim(invoicePaidEvent())).toBe("claimed");

    const row = await rowFor("evt_invoice_1");
    expect(row).toMatchObject({
      status: "processing",
      attempts: 2,
      stripe_subscription_id: "sub_100",
      stripe_customer_id: "cus_100",
      request_id: "req_9",
    });
    expect(row?.last_error).toBeNull();
  });

  it("stores nulls for the ids an event does not carry", async () => {
    // A dispute has no customer, invoice, or subscription. These must be SQL
    // nulls rather than empty strings, or `where stripe_invoice_id is null`
    // silently misses them.
    await claim(
      invoicePaidEvent({
        id: "evt_dispute_1",
        type: "charge.dispute.created",
        request: null,
        data: { object: { object: "dispute", id: "dp_1", charge: "ch_1" } },
      })
    );

    const row = await rowFor("evt_dispute_1");

    expect(row?.stripe_object_id).toBe("dp_1");
    expect(row?.stripe_customer_id).toBeNull();
    expect(row?.stripe_invoice_id).toBeNull();
    expect(row?.stripe_subscription_id).toBeNull();
    expect(row?.request_id).toBeNull();
  });

  it("parks an event as action_required with the reason on the row", async () => {
    await claim(invoicePaidEvent());
    await markStripeWebhookEventActionRequired(
      "evt_invoice_1",
      "unmapped_price (stripe_price_id=price_x)"
    );

    const row = await rowFor("evt_invoice_1");

    expect(row?.status).toBe("action_required");
    expect(row?.last_error).toContain("price_x");
    // Not completed: the work did not happen, and `processed_at` staying null is
    // what keeps that visible.
    expect(row?.processed_at).toBeNull();
  });

  it("lets a deliberate replay reclaim an action_required event", async () => {
    // Stripe's automatic retries were stopped with a 200, so the only delivery
    // that reaches here is one a human triggered after fixing the cause.
    // Refusing it would mean the fix could never be applied to the event that
    // found the problem.
    await claim(invoicePaidEvent());
    await markStripeWebhookEventActionRequired("evt_invoice_1", "unmapped_price");

    expect(await claim(invoicePaidEvent())).toBe("claimed");

    const row = await rowFor("evt_invoice_1");
    expect(row?.status).toBe("processing");
    expect(row?.attempts).toBe(2);
    // The old reason is cleared, or a resolved event would still read as broken.
    expect(row?.last_error).toBeNull();
  });

  it("keeps action_required distinct from completed for a sweep to find", async () => {
    // What step 4's reconciliation sweep queries. If parking an event had reused
    // `completed`, there would be nothing to select.
    await claim(invoicePaidEvent());
    await markStripeWebhookEventActionRequired("evt_invoice_1", "unmapped_price");

    await claim(invoicePaidEvent({ id: "evt_ok" }));
    await markStripeWebhookEventCompleted("evt_ok");

    const needsAction = await db()
      .select()
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.status, "action_required"));

    expect(needsAction.map((row) => row.event_id)).toEqual(["evt_invoice_1"]);
  });

  it("lists events for the admin console without their payloads", async () => {
    // The payload holds the whole Stripe object — for a checkout session that
    // includes the customer's email and address. The console answers its
    // questions from the denormalized columns instead, and a payload nobody
    // fetches is a payload that cannot leak into a browser.
    await claim(invoicePaidEvent());

    const [row] = await listStripeWebhookEvents({});

    expect(row).toMatchObject({
      event_id: "evt_invoice_1",
      stripe_invoice_id: "in_100",
      stripe_customer_id: "cus_100",
    });
    expect("payload" in row!).toBe(false);
  });

  it("filters the list by status", async () => {
    await claim(invoicePaidEvent());
    await markStripeWebhookEventActionRequired("evt_invoice_1", "unmapped_price");
    await claim(invoicePaidEvent({ id: "evt_done" }));
    await markStripeWebhookEventCompleted("evt_done");

    const parked = await listStripeWebhookEvents({ status: "action_required" });
    const done = await listStripeWebhookEvents({ status: "completed" });
    const all = await listStripeWebhookEvents({});

    expect(parked.map((r) => r.event_id)).toEqual(["evt_invoice_1"]);
    expect(done.map((r) => r.event_id)).toEqual(["evt_done"]);
    expect(all).toHaveLength(2);
  });

  it("orders by arrival, not by last update", async () => {
    // An operator scanning this asks "what came in". Sorting by `updated_at`
    // would reshuffle the page every time the sweep or a retry touched a row.
    await claim(invoicePaidEvent({ id: "evt_first" }));
    await claim(invoicePaidEvent({ id: "evt_second" }));
    await db()
      .update(stripeWebhookEvents)
      .set({ received_at: new Date(Date.now() - 60_000) })
      .where(eq(stripeWebhookEvents.event_id, "evt_second"));
    // Touch the older row, which would move it to the top under the wrong sort.
    await markStripeWebhookEventActionRequired("evt_second", "unmapped_price");

    const rows = await listStripeWebhookEvents({});

    expect(rows.map((r) => r.event_id)).toEqual(["evt_first", "evt_second"]);
  });

  it("records a test-mode event as livemode false, not as unknown", async () => {
    await claim(invoicePaidEvent({ id: "evt_test_mode_1", livemode: false }));

    // `false` means test mode; `null` would mean "written before 0019". The
    // column has to keep those apart.
    expect((await rowFor("evt_test_mode_1"))?.livemode).toBe(false);
  });
});
