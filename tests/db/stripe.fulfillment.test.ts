/**
 * Database tier: paying and crediting commit together.
 *
 * This file exists because of a bug, and the bug's shape is the reason these
 * assertions cannot be mocked.
 *
 * Fulfillment used to be two sequential writes guarded by an early return when
 * the order was already `paid`. That guard checked whether the *payment* was
 * recorded, then skipped work that was not the payment. A crash between the two
 * writes therefore left a paid order with no credits, and the next delivery
 * cemented it: Stripe redelivers, the handler sees `paid`, returns, and the
 * event is marked completed. Nothing throws. Nobody is told. The customer has
 * paid for credits they will never receive.
 *
 * What replaced it needs Postgres to verify:
 *
 *   - the transaction, so a failed grant takes the status write back with it
 *   - `ON CONFLICT DO NOTHING` on `credits.trans_no`, which is the only thing
 *     standing between two concurrent deliveries and a double grant
 *   - the same on `orders.order_no` for renewals
 *
 * A mock would assert what we believe those clauses do. Only the database knows.
 */
import { describe, expect, it } from "vitest";

import { describeDb, useCleanDatabase } from "./setup";

import {
  insertRenewalOrderWithGrant,
  markOrderPaidWithGrant,
} from "@/models/fulfillment";
import { insertOrder, OrderStatus, findOrderByOrderNo } from "@/models/order";
import { listAllCreditsByOrg, findCreditByTransNo } from "@/models/credit";
import {
  orderPayTransNo,
  renewalOrderNo,
  subscriptionPeriodTransNo,
} from "@/services/stripe/idempotency";

const ORG = "org-fulfil";
const USER = "user-fulfil";
const SUB = "sub_fulfil";
const PERIOD_START = 1767225600;

async function seedCreatedOrder(orderNo: string, credits = 100) {
  return insertOrder({
    order_no: orderNo,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    org_uuid: ORG,
    user_uuid: USER,
    user_email: "buyer@example.com",
    amount: 2900,
    interval: "month",
    expired_at: new Date("2026-02-02T00:00:00.000Z"),
    status: OrderStatus.Created,
    credits,
    currency: "usd",
    product_id: "plus-monthly",
    product_name: "Plus",
    valid_months: 1,
  });
}

/**
 * Sum of every ledger row for the org, expired or not.
 *
 * Deliberately not `getOrgValidCredits`: that applies the expiry window, so
 * these tests would depend on where the fixture dates sit relative to today's
 * clock — and would start failing on a date, for a reason that has nothing to do
 * with fulfillment. Expiry semantics belong to `credits.ledger.test.ts`. What
 * this tier is asking is only ever "did the grant land, and how many times".
 */
async function ledgerTotal(): Promise<number> {
  const rows = await listAllCreditsByOrg(ORG);
  return rows.reduce((sum, row) => sum + (row.credits ?? 0), 0);
}

function paidArgs(orderNo: string, credits = 100) {
  return {
    order_no: orderNo,
    org_uuid: ORG,
    user_uuid: USER,
    paid_at: new Date("2026-01-01T12:00:00.000Z"),
    paid_email: "buyer@example.com",
    paid_detail: "{}",
    grant: {
      trans_no: orderPayTransNo(orderNo),
      trans_type: "order_pay",
      credits,
      expired_at: new Date("2026-02-02T00:00:00.000Z"),
    },
  };
}

function renewalArgs(credits = 100) {
  const orderNo = renewalOrderNo(SUB, PERIOD_START);
  return {
    order: {
      order_no: orderNo,
      created_at: new Date("2026-02-01T00:00:00.000Z"),
      org_uuid: ORG,
      user_uuid: USER,
      user_email: "buyer@example.com",
      amount: 2900,
      interval: "month",
      expired_at: new Date("2026-03-02T00:00:00.000Z"),
      status: OrderStatus.Paid,
      credits,
      currency: "usd",
      product_id: "plus-monthly",
      product_name: "Plus",
      valid_months: 1,
      sub_id: SUB,
      sub_period_start: PERIOD_START,
      paid_at: new Date("2026-02-01T00:00:00.000Z"),
    },
    grant: {
      trans_no: subscriptionPeriodTransNo(SUB, PERIOD_START),
      trans_type: "order_pay",
      credits,
      expired_at: new Date("2026-03-02T00:00:00.000Z"),
    },
  };
}

describeDb("stripe fulfillment", () => {
  // Once per file: `useCleanDatabase` closes the connection in `afterAll`, so a
  // second call would tear the pool down while the next block is still running.
  useCleanDatabase();

  describe("checkout", () => {
    it("marks the order paid and credits the org in one call", async () => {
      await seedCreatedOrder("order-1");

      const result = await markOrderPaidWithGrant(paidArgs("order-1"));

      expect(result.order?.status).toBe(OrderStatus.Paid);
      expect(result.credit_granted).toBe(true);
      expect(await ledgerTotal()).toBe(100);
    });

    /**
     * The regression test for the original bug, reproduced exactly: an order that
     * already says `paid` but whose credit row never landed. The old code returned
     * early here and the credits were lost permanently.
     */
    it("grants the credits for an order already marked paid but never credited", async () => {
      await seedCreatedOrder("order-2");

      // Mark it paid *without* the grant — precisely the state a crash between
      // the two old writes left behind.
      await markOrderPaidWithGrant({ ...paidArgs("order-2"), grant: null });
      expect(await ledgerTotal()).toBe(0);

      const replay = await markOrderPaidWithGrant(paidArgs("order-2"));

      expect(replay.credit_granted).toBe(true);
      expect(await ledgerTotal()).toBe(100);
    });

    it("does not grant twice when the same event is replayed", async () => {
      await seedCreatedOrder("order-3");

      const first = await markOrderPaidWithGrant(paidArgs("order-3"));
      const second = await markOrderPaidWithGrant(paidArgs("order-3"));

      expect(first.credit_granted).toBe(true);
      // Reported, not swallowed: the caller needs to tell a correct replay from a
      // first delivery that granted nothing.
      expect(second.credit_granted).toBe(false);
      expect(await ledgerTotal()).toBe(100);
    });

    it("grants once when two deliveries arrive concurrently", async () => {
      await seedCreatedOrder("order-4");

      const results = await Promise.all([
        markOrderPaidWithGrant(paidArgs("order-4")),
        markOrderPaidWithGrant(paidArgs("order-4")),
      ]);

      expect(results.filter((r) => r.credit_granted)).toHaveLength(1);
      expect(await ledgerTotal()).toBe(100);
    });

    /**
     * The atomicity claim. Nothing above proves the two writes share a
     * transaction — only that replay converges. This does: a grant that fails must
     * take the status write with it, or the paid-but-uncredited state is reachable
     * again by a different route.
     */
    it("rolls the paid status back when the grant fails", async () => {
      await seedCreatedOrder("order-5");

      // A trans_no longer than the column allows. Postgres rejects it at COMMIT
      // time, inside the same transaction as the status update.
      await expect(
        markOrderPaidWithGrant({
          ...paidArgs("order-5"),
          grant: {
            ...paidArgs("order-5").grant,
            trans_no: "x".repeat(300),
          },
        }),
      ).rejects.toThrow();

      const order = await findOrderByOrderNo("order-5");
      expect(order?.status).toBe(OrderStatus.Created);
      expect(order?.paid_at).toBeNull();
      expect(await ledgerTotal()).toBe(0);
    });

    it("refuses to credit an order belonging to another organization", async () => {
      await seedCreatedOrder("order-6");

      const result = await markOrderPaidWithGrant({
        ...paidArgs("order-6"),
        org_uuid: "org-someone-else",
      });

      expect(result.order).toBeUndefined();
      expect(result.credit_granted).toBe(false);

      const order = await findOrderByOrderNo("order-6");
      expect(order?.status).toBe(OrderStatus.Created);
      // The scoped update matched nothing, so no ledger row was written against
      // the attacker's org either.
      expect(
        await findCreditByTransNo(orderPayTransNo("order-6")),
      ).toBeUndefined();
    });

    it("skips the ledger row when the order carries no credits", async () => {
      await seedCreatedOrder("order-7", 0);

      const result = await markOrderPaidWithGrant({
        ...paidArgs("order-7", 0),
        grant: { ...paidArgs("order-7", 0).grant, credits: 0 },
      });

      expect(result.order?.status).toBe(OrderStatus.Paid);
      expect(result.credit_granted).toBe(false);
      expect(await ledgerTotal()).toBe(0);
    });
  });

  describe("renewal", () => {
    it("records the renewal order and credits it", async () => {
      const result = await insertRenewalOrderWithGrant(renewalArgs());

      expect(result.order_created).toBe(true);
      expect(result.credit_granted).toBe(true);
      expect(await ledgerTotal()).toBe(100);
    });

    /**
     * The renewal half of the original bug: the order for a cycle was inserted
     * before the grant, and the old guard skipped the whole branch whenever that
     * order existed — so a cycle recorded without its credits stayed that way.
     */
    it("grants the credits for a renewal order that was recorded without them", async () => {
      await insertRenewalOrderWithGrant({ ...renewalArgs(), grant: null });
      expect(await ledgerTotal()).toBe(0);

      const replay = await insertRenewalOrderWithGrant(renewalArgs());

      expect(replay.order_created).toBe(false);
      expect(replay.credit_granted).toBe(true);
      expect(await ledgerTotal()).toBe(100);
    });

    it("opens one order and grants once across repeated deliveries", async () => {
      const first = await insertRenewalOrderWithGrant(renewalArgs());
      const second = await insertRenewalOrderWithGrant(renewalArgs());

      expect(first.order_created).toBe(true);
      expect(second.order_created).toBe(false);
      expect(second.credit_granted).toBe(false);
      expect(await ledgerTotal()).toBe(100);
    });

    it("opens one order and grants once when deliveries race", async () => {
      const results = await Promise.all([
        insertRenewalOrderWithGrant(renewalArgs()),
        insertRenewalOrderWithGrant(renewalArgs()),
      ]);

      expect(results.filter((r) => r.order_created)).toHaveLength(1);
      expect(results.filter((r) => r.credit_granted)).toHaveLength(1);
      expect(await ledgerTotal()).toBe(100);
    });

    it("treats the next billing period as a separate grant", async () => {
      const nextStart = PERIOD_START + 31 * 24 * 60 * 60;
      const next = renewalArgs();

      await insertRenewalOrderWithGrant(renewalArgs());
      await insertRenewalOrderWithGrant({
        order: {
          ...next.order,
          order_no: renewalOrderNo(SUB, nextStart),
          sub_period_start: nextStart,
        },
        grant: {
          ...next.grant,
          trans_no: subscriptionPeriodTransNo(SUB, nextStart),
        },
      });

      // The whole point of keying on the period rather than the subscription:
      // renewals must accumulate.
      expect(await ledgerTotal()).toBe(200);
    });
  });
});
