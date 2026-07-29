/**
 * Database tier: affiliate commission idempotency.
 *
 * Two webhook workers may try to reward the same paid order at the same time.
 * Only the partial unique index can serialize separate processes, so this
 * invariant belongs in the real-database tier rather than behind a mock.
 */
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { affiliates } from "@/db/schema";
import {
  insertAffiliate,
  insertPaidAffiliateOnce,
  insertSignupAffiliateOnce,
} from "@/models/affiliate";

import { describeDb, useCleanDatabase } from "./setup";

const paidReward = {
  user_uuid: "buyer-1",
  invited_by: "referrer-1",
  status: "completed",
  paid_order_no: "order-1",
  paid_amount: 5000,
  reward_percent: 10,
  reward_amount: 500,
  created_at: new Date(),
};

describeDb("affiliate rewards (real database)", () => {
  useCleanDatabase();

  it("creates one reward when the same paid order races", async () => {
    const results = await Promise.all([
      insertPaidAffiliateOnce(paidReward),
      insertPaidAffiliateOnce(paidReward),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);

    const rows = await db()
      .select()
      .from(affiliates)
      .where(eq(affiliates.paid_order_no, paidReward.paid_order_no));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      paid_order_no: "order-1",
      reward_amount: 500,
    });
  });

  it("still allows one signup-attribution row per invited user", async () => {
    const results = await Promise.all([
      insertSignupAffiliateOnce({
        ...paidReward,
        user_uuid: "buyer-1",
        paid_order_no: "",
        paid_amount: 0,
        reward_amount: 0,
      }),
      insertSignupAffiliateOnce({
        ...paidReward,
        user_uuid: "buyer-1",
        paid_order_no: "",
        paid_amount: 0,
        reward_amount: 0,
      }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);

    await insertAffiliate({
        ...paidReward,
        user_uuid: "buyer-2",
        paid_order_no: "",
        paid_amount: 0,
        reward_amount: 0,
    });

    const rows = await db()
      .select()
      .from(affiliates)
      .where(eq(affiliates.paid_order_no, ""));

    expect(rows).toHaveLength(2);
  });
});
