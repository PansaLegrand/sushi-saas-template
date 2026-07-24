/**
 * Database tier: the credit ledger.
 *
 * The ledger is append-only — balance is the sum of rows, never a stored
 * column. That makes two things load-bearing, and both live in the database
 * rather than in TypeScript:
 *
 *   1. `credits.trans_no` is UNIQUE. Every idempotency guarantee in the app
 *      (signup grants, refunds, order fulfilment) is that constraint. Route and
 *      service tests mock `insertCredit`, so they assert the belief, not the
 *      constraint.
 *   2. Balance arithmetic runs over rows that came back from Postgres, with
 *      real timestamptz values. Expiry in particular is a comparison against
 *      `expired_at`, and a mocked row cannot get that wrong.
 */
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  UNIQUE_VIOLATION,
  describeDb,
  errorCode,
  useCleanDatabase,
} from "./setup";

import { db } from "@/db";
import { credits as creditsTable } from "@/db/schema";
import {
  CreditsTransType,
  decreaseCredits,
  getUserCreditSummary,
  getUserCredits,
  increaseCredits,
  refundCreditsForTransaction,
} from "@/services/credit";
import { jobHandlers } from "@/services/jobs/handlers";

const USER = "user-ledger-test";

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function countRows(userUuid = USER): Promise<number> {
  const rows = await db()
    .select()
    .from(creditsTable)
    .where(eq(creditsTable.user_uuid, userUuid));
  return rows.length;
}

describeDb("credit ledger (real database)", () => {
  useCleanDatabase();

  it("derives balance from granted minus consumed", async () => {
    await increaseCredits({
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 100,
    });
    await decreaseCredits({
      user_uuid: USER,
      trans_type: CreditsTransType.Ping,
      credits: 30,
    });

    const summary = await getUserCreditSummary(USER);

    expect(summary.granted).toBe(100);
    expect(summary.consumed).toBe(30);
    expect(summary.balance).toBe(70);
    expect(summary.ledger).toHaveLength(2);
  });

  it("refuses to spend more than the balance and writes nothing", async () => {
    await increaseCredits({
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 10,
    });

    await expect(
      decreaseCredits({
        user_uuid: USER,
        trans_type: CreditsTransType.Ping,
        credits: 25,
      })
    ).rejects.toThrow(/insufficient credits/i);

    // The guard has to hold at the row level, not just in the return value:
    // a rejected spend that still inserted a negative row would corrupt the
    // balance silently.
    expect(await countRows()).toBe(1);
    expect((await getUserCreditSummary(USER)).balance).toBe(10);
  });

  it("rejects a replayed trans_no with a unique violation", async () => {
    const transNo = "fixed-trans-no";

    await increaseCredits({
      user_uuid: USER,
      trans_type: CreditsTransType.NewUser,
      credits: 10,
      trans_no: transNo,
    });

    const replay = increaseCredits({
      user_uuid: USER,
      trans_type: CreditsTransType.NewUser,
      credits: 10,
      trans_no: transNo,
    }).catch((e) => e);

    expect(errorCode(await replay)).toBe(UNIQUE_VIOLATION);
    expect(await countRows()).toBe(1);
  });

  it("grants signup credits exactly once when the job is retried", async () => {
    // This is the contract `jobHandlers.new_user_credits` relies on: it swallows
    // 23505 and calls that success. If the unique index on trans_no ever went
    // missing, that catch would turn a retry into a second free grant.
    const payload = { userUuid: USER, credits: 10 };

    await jobHandlers.new_user_credits(payload);
    await jobHandlers.new_user_credits(payload);
    await jobHandlers.new_user_credits(payload);

    expect(await countRows()).toBe(1);
    expect((await getUserCreditSummary(USER)).balance).toBe(10);
  });

  it("excludes expired grants from the balance but still reports them", async () => {
    await increaseCredits({
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 50,
      expired_at: daysFromNow(-1),
    });
    await increaseCredits({
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 20,
      expired_at: daysFromNow(30),
    });

    const summary = await getUserCreditSummary(USER);

    expect(summary.expired).toBe(50);
    expect(summary.balance).toBe(20);
    expect(summary.granted).toBe(20);
  });

  it("flags grants inside the expiring-soon window only", async () => {
    await increaseCredits({
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 5,
      expired_at: daysFromNow(3),
    });
    await increaseCredits({
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 7,
      expired_at: daysFromNow(90),
    });

    const summary = await getUserCreditSummary(USER);

    expect(summary.expiringSoon).toHaveLength(1);
    expect(summary.expiringSoon[0]?.credits).toBe(5);
  });

  it("refunds a spend once, however many times it is retried", async () => {
    await increaseCredits({
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 100,
    });
    const spendTransNo = await decreaseCredits({
      user_uuid: USER,
      trans_type: CreditsTransType.TaskTextToVideo,
      credits: 40,
    });

    const first = await refundCreditsForTransaction({
      user_uuid: USER,
      original_trans_no: spendTransNo,
    });
    const second = await refundCreditsForTransaction({
      user_uuid: USER,
      original_trans_no: spendTransNo,
    });

    expect(second).toBe(first);
    expect(await countRows()).toBe(3);
    expect((await getUserCreditSummary(USER)).balance).toBe(100);
  });

  it("refuses to refund a transaction belonging to another user", async () => {
    await increaseCredits({
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 50,
    });
    const spendTransNo = await decreaseCredits({
      user_uuid: USER,
      trans_type: CreditsTransType.Ping,
      credits: 5,
    });

    await expect(
      refundCreditsForTransaction({
        user_uuid: "someone-else",
        original_trans_no: spendTransNo,
      })
    ).rejects.toThrow(/does not belong/i);
  });

  it("never reports a negative spendable balance", async () => {
    // getUserCredits floors at zero for display; the ledger itself may still go
    // negative through an admin adjustment, and the two must not disagree.
    await db()
      .insert(creditsTable)
      .values({
        trans_no: "manual-negative",
        created_at: new Date(),
        user_uuid: USER,
        trans_type: CreditsTransType.TaskAdjust,
        credits: -25,
        order_no: "",
      });

    const status = await getUserCredits(USER);

    expect(status.left_credits).toBe(0);
    expect(status.is_pro).toBe(false);
  });
});
