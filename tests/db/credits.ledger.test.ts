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
 *
 * `balance_after` adds a third, and it is the reason these tests cannot be
 * mocked at all: the column is only correct when the total is read under the
 * per-org advisory lock that is still held when the row lands. A mock has no
 * lock, so it would pass whether or not the real thing serializes.
 */
import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";

import {
  UNIQUE_VIOLATION,
  describeDb,
  errorCode,
  useCleanDatabase,
} from "./setup";

import { db } from "@/db";
import { credits as creditsTable, users } from "@/db/schema";
import { calculateCreditBalance, findCreditByTransNo } from "@/models/credit";
import {
  CreditsTransType,
  decreaseCredits,
  getOrgCreditSummary,
  getOrgCredits,
  increaseCredits,
  refundCreditsForTransaction,
} from "@/services/credit";
import { jobHandlers } from "@/services/jobs/handlers";
import { ensurePersonalOrganization } from "@/services/organizations";

/**
 * Real rows rather than string constants.
 *
 * The balance is keyed on an organization now, and `jobHandlers.new_user_credits`
 * resolves that organization from the user. A made-up uuid would make the
 * handler throw rather than exercise the idempotency this file is about.
 */
let USER = "";
let ORG = "";

async function seedUserWithOrg(): Promise<{ user: string; org: string }> {
  const id = randomUUID();
  const uuid = randomUUID();

  await db()
    .insert(users)
    .values({
      id,
      uuid,
      email: `ledger-${uuid}@test.dev`,
      signin_provider: "credential",
    });

  const org = await ensurePersonalOrganization({
    id,
    email: `ledger-${uuid}@test.dev`,
  });
  return { user: uuid, org: org.uuid };
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function countRows(orgUuid = ORG): Promise<number> {
  const rows = await db()
    .select()
    .from(creditsTable)
    .where(eq(creditsTable.org_uuid, orgUuid));
  return rows.length;
}

/** Every row for an org in insertion order — the order `balance_after` follows. */
async function ledgerRows(orgUuid = ORG) {
  return db()
    .select()
    .from(creditsTable)
    .where(eq(creditsTable.org_uuid, orgUuid))
    .orderBy(asc(creditsTable.id));
}

describeDb("credit ledger (real database)", () => {
  useCleanDatabase();

  // Registered after the harness's truncate, so it repopulates a clean slate.
  beforeEach(async () => {
    const seeded = await seedUserWithOrg();
    USER = seeded.user;
    ORG = seeded.org;
  });

  it("derives balance from granted minus consumed", async () => {
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 100,
      actor: "system:test",
    });
    await decreaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.Ping,
      credits: 30,
      actor: `user:${USER}`,
    });

    const summary = await getOrgCreditSummary(ORG);

    expect(summary.granted).toBe(100);
    expect(summary.consumed).toBe(30);
    expect(summary.balance).toBe(70);
    expect(summary.ledger).toHaveLength(2);
  });

  it("refuses to spend more than the balance and writes nothing", async () => {
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 10,
      actor: "system:test",
    });

    await expect(
      decreaseCredits({
        org_uuid: ORG,
        user_uuid: USER,
        trans_type: CreditsTransType.Ping,
        credits: 25,
        actor: `user:${USER}`,
      }),
    ).rejects.toMatchObject({
      code: "CREDITS_INSUFFICIENT",
      // The numbers that turn "not enough credits" into "buy 15 more". They
      // come out of the refusing transaction itself, so they cannot disagree
      // with the decision they explain.
      details: { required: 25, available: 10, shortfall: 15 },
    });

    // The guard has to hold at the row level, not just in the return value:
    // a rejected spend that still inserted a negative row would corrupt the
    // balance silently.
    expect(await countRows()).toBe(1);
    expect((await getOrgCreditSummary(ORG)).balance).toBe(10);
  });

  it("counts spends, not just grants, when reporting the balance available", async () => {
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 10,
      actor: "system:test",
    });
    await decreaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.Ping,
      credits: 7,
      actor: `user:${USER}`,
    });

    // 3 left, not the 10 that were granted. Summing grants alone is the obvious
    // wrong implementation and produces copy that contradicts the refusal.
    await expect(
      decreaseCredits({
        org_uuid: ORG,
        user_uuid: USER,
        trans_type: CreditsTransType.Ping,
        credits: 5,
        actor: `user:${USER}`,
      }),
    ).rejects.toMatchObject({
      details: { required: 5, available: 3, shortfall: 2 },
    });
  });

  it("serializes concurrent spends so one balance cannot be spent twice", async () => {
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 10,
      actor: "system:test",
    });

    const results = await Promise.allSettled([
      decreaseCredits({
        org_uuid: ORG,
        user_uuid: USER,
        trans_type: CreditsTransType.Ping,
        credits: 10,
        actor: `user:${USER}`,
      }),
      decreaseCredits({
        org_uuid: ORG,
        user_uuid: USER,
        trans_type: CreditsTransType.Ping,
        credits: 10,
        actor: `user:${USER}`,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "CREDITS_INSUFFICIENT" }),
    });
    expect(await countRows()).toBe(2);
    expect((await getOrgCreditSummary(ORG)).balance).toBe(0);
  });

  it("rejects a replayed trans_no with a unique violation", async () => {
    const transNo = "fixed-trans-no";

    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.NewUser,
      credits: 10,
      trans_no: transNo,
      actor: "system:test",
    });

    const replay = increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.NewUser,
      credits: 10,
      trans_no: transNo,
      actor: "system:test",
    }).catch((e) => e);

    expect(errorCode(await replay)).toBe(UNIQUE_VIOLATION);
    expect(await countRows()).toBe(1);
  });

  it("grants signup credits exactly once when the job is retried", async () => {
    // This is the contract `jobHandlers.new_user_credits` relies on: it swallows
    // 23505 and calls that success. If the unique index on trans_no ever went
    // missing, that catch would turn a retry into a second free grant.
    const payload = { userUuid: USER, credits: 10 };
    const context = {
      jobUuid: "new-user-credit-job",
      attempt: 1,
      maxAttempts: 5,
      signal: new AbortController().signal,
    };

    await jobHandlers.new_user_credits(payload, context);
    await jobHandlers.new_user_credits(payload, { ...context, attempt: 2 });
    await jobHandlers.new_user_credits(payload, { ...context, attempt: 3 });

    expect(await countRows()).toBe(1);
    expect((await getOrgCreditSummary(ORG)).balance).toBe(10);
  });

  it("excludes expired grants from the balance but still reports them", async () => {
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 50,
      expired_at: daysFromNow(-1),
      actor: "system:test",
    });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 20,
      expired_at: daysFromNow(30),
      actor: "system:test",
    });

    const summary = await getOrgCreditSummary(ORG);

    expect(summary.expired).toBe(50);
    expect(summary.balance).toBe(20);
    expect(summary.granted).toBe(20);
  });

  it("flags grants inside the expiring-soon window only", async () => {
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 5,
      expired_at: daysFromNow(3),
      actor: "system:test",
    });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 7,
      expired_at: daysFromNow(90),
      actor: "system:test",
    });

    const summary = await getOrgCreditSummary(ORG);

    expect(summary.expiringSoon).toHaveLength(1);
    expect(summary.expiringSoon[0]?.credits).toBe(5);
  });

  it("partially consumes the earliest-expiring bucket first", async () => {
    const earlyExpiry = daysFromNow(3);
    const laterExpiry = daysFromNow(30);

    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 10,
      order_no: "early-order",
      expired_at: earlyExpiry,
      actor: "stripe:webhook",
    });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 20,
      order_no: "later-order",
      expired_at: laterExpiry,
      actor: "stripe:webhook",
    });

    const transNo = await decreaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.Ping,
      credits: 4,
      actor: `user:${USER}`,
    });

    const spend = (await ledgerRows()).find((row) => row.trans_no === transNo);
    expect(spend).toMatchObject({
      credits: -4,
      order_no: "early-order",
    });
    expect(spend?.expired_at?.getTime()).toBe(earlyExpiry.getTime());

    const summary = await getOrgCreditSummary(ORG);
    expect(summary).toMatchObject({
      balance: 26,
      granted: 30,
      consumed: 4,
      expired: 0,
    });
    // The warning is the six credits actually left in the bucket, not the
    // original ten-credit grant.
    expect(summary.expiringSoon.map((entry) => entry.credits)).toEqual([6]);
  });

  it("splits a cross-expiry spend into one immutable row per FEFO bucket", async () => {
    const earlyExpiry = daysFromNow(5);
    const laterExpiry = daysFromNow(30);

    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 5,
      order_no: "early-order",
      expired_at: earlyExpiry,
      actor: "stripe:webhook",
    });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 10,
      order_no: "later-order",
      expired_at: laterExpiry,
      actor: "stripe:webhook",
    });

    const transNo = await decreaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.TaskTextToVideo,
      credits: 8,
      actor: `user:${USER}`,
      metadata: { task_uuid: "cross-bucket-task" },
    });

    const spends = (await ledgerRows()).filter((row) => row.credits < 0);
    expect(spends.map((row) => row.trans_no)).toEqual([
      transNo,
      `${transNo}:part:2`,
    ]);
    expect(
      spends.map((row) => ({
        credits: row.credits,
        orderNo: row.order_no,
        expiredAt: row.expired_at?.getTime(),
      })),
    ).toEqual([
      {
        credits: -5,
        orderNo: "early-order",
        expiredAt: earlyExpiry.getTime(),
      },
      {
        credits: -3,
        orderNo: "later-order",
        expiredAt: laterExpiry.getTime(),
      },
    ]);
    expect((await ledgerRows()).map((row) => row.balance_after)).toEqual([
      5, 15, 10, 7,
    ]);

    const rootMetadata = JSON.parse(spends[0]!.metadata_json!);
    expect(rootMetadata).toMatchObject({
      task_uuid: "cross-bucket-task",
      __credit_fefo: {
        version: 1,
        root_trans_no: transNo,
        part_trans_nos: [transNo, `${transNo}:part:2`],
        part_index: 0,
      },
    });

    const summary = await getOrgCreditSummary(ORG);
    const logicalSpend = summary.ledger.find((row) => row.transNo === transNo);
    const status = await getOrgCredits(ORG);
    expect(summary.balance).toBe(7);
    expect(status.left_credits).toBe(summary.balance);
    expect(summary.ledger).toHaveLength(3);
    expect(logicalSpend).toMatchObject({
      transNo,
      transType: CreditsTransType.TaskTextToVideo,
      credits: -8,
      orderNo: null,
      expiredAt: null,
      balanceAfter: 7,
    });
    expect(JSON.stringify(summary)).not.toContain(":part:2");
    expect(JSON.stringify(summary)).not.toContain("__credit_fefo");

    // Pagination is applied after logical grouping: one action consumes one
    // customer ledger slot even when it needed two immutable debit rows.
    const limitedSummary = await getOrgCreditSummary(ORG, { ledgerLimit: 1 });
    expect(limitedSummary.ledger).toEqual([
      expect.objectContaining({ transNo, credits: -8 }),
    ]);

    const logicalRoot = await findCreditByTransNo(transNo);
    const logicalFromChild = await findCreditByTransNo(`${transNo}:part:2`);
    expect(logicalRoot).toMatchObject({
      trans_no: transNo,
      credits: -8,
      order_no: null,
      expired_at: null,
      balance_after: 7,
    });
    expect(JSON.parse(logicalRoot!.metadata_json!)).toEqual({
      task_uuid: "cross-bucket-task",
    });
    expect(logicalFromChild).toEqual(logicalRoot);

    const auditSummary = await getOrgCreditSummary(ORG, {
      includeAudit: true,
    });
    const auditSpendRows = auditSummary.ledger.filter(
      (row) => row.transNo === transNo || row.transNo === `${transNo}:part:2`,
    );
    expect(auditSpendRows).toHaveLength(2);
    expect(
      auditSpendRows
        .map((row) => row.credits)
        .sort((left, right) => left - right),
    ).toEqual([-5, -3]);
    expect(auditSpendRows.every((row) => row.metadata?.__credit_fefo)).toBe(
      true,
    );

    await expect(
      decreaseCredits({
        org_uuid: ORG,
        user_uuid: USER,
        trans_type: CreditsTransType.Ping,
        credits: 8,
        actor: `user:${USER}`,
      }),
    ).rejects.toMatchObject({
      code: "CREDITS_INSUFFICIENT",
      details: { required: 8, available: 7, shortfall: 1 },
    });
  });

  it("keeps later-bucket credits after an earlier consumed bucket expires", async () => {
    const baseline = Date.now();
    const earlyExpiry = new Date(baseline + 5 * 24 * 60 * 60 * 1000);
    const laterExpiry = new Date(baseline + 30 * 24 * 60 * 60 * 1000);

    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 5,
      order_no: "early-order",
      expired_at: earlyExpiry,
      actor: "stripe:webhook",
    });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 10,
      order_no: "later-order",
      expired_at: laterExpiry,
      actor: "stripe:webhook",
    });
    await decreaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.Ping,
      credits: 8,
      actor: `user:${USER}`,
    });

    const rows = await ledgerRows();
    const beforeEarlyExpiry = calculateCreditBalance(
      rows,
      new Date(baseline + 2 * 24 * 60 * 60 * 1000),
    );
    const afterEarlyExpiry = calculateCreditBalance(
      rows,
      new Date(baseline + 10 * 24 * 60 * 60 * 1000),
    );
    const afterAllExpiry = calculateCreditBalance(
      rows,
      new Date(baseline + 40 * 24 * 60 * 60 * 1000),
    );

    expect(beforeEarlyExpiry.available).toBe(7);
    // The old single-debit implementation returned 2 here: it dropped the
    // early +5 grant but kept the whole -8 debit attached to the later grant.
    expect(afterEarlyExpiry.available).toBe(7);
    expect(afterEarlyExpiry.expired).toBe(0);
    expect(afterAllExpiry.available).toBe(0);
    expect(afterAllExpiry.expired).toBe(7);
  });

  it("replays and correctly refunds a legacy single-row cross-bucket spend", async () => {
    const baseline = Date.now();
    const earlyExpiry = new Date(baseline + 5 * 24 * 60 * 60 * 1000);
    const laterExpiry = new Date(baseline + 30 * 24 * 60 * 60 * 1000);

    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 5,
      order_no: "legacy-early-order",
      expired_at: earlyExpiry,
      actor: "stripe:webhook",
    });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 10,
      order_no: "legacy-later-order",
      expired_at: laterExpiry,
      actor: "stripe:webhook",
    });

    // This is the pre-FEFO bug shape: all -8 was tagged with only the last
    // bucket's terms, even though five of it consumed the earlier grant.
    await db()
      .insert(creditsTable)
      .values({
        trans_no: "legacy-cross-bucket-spend",
        created_at: new Date(),
        org_uuid: ORG,
        user_uuid: USER,
        trans_type: CreditsTransType.TaskTextToVideo,
        credits: -8,
        order_no: "legacy-later-order",
        expired_at: laterExpiry,
        balance_after: 7,
        actor: `user:${USER}`,
      });

    const legacyRows = await ledgerRows();
    expect(
      calculateCreditBalance(
        legacyRows,
        new Date(baseline + 10 * 24 * 60 * 60 * 1000),
      ).available,
    ).toBe(7);

    const refundTransNo = await refundCreditsForTransaction({
      org_uuid: ORG,
      user_uuid: USER,
      original_trans_no: "legacy-cross-bucket-spend",
    });
    const refunds = (await ledgerRows()).filter(
      (row) =>
        row.trans_no === refundTransNo ||
        row.trans_no.startsWith(`${refundTransNo}:part:`),
    );

    expect(refunds.map((row) => row.credits)).toEqual([5, 3]);
    expect(refunds.map((row) => row.expired_at?.getTime())).toEqual([
      earlyExpiry.getTime(),
      laterExpiry.getTime(),
    ]);
    expect((await getOrgCreditSummary(ORG)).balance).toBe(15);
  });

  it("refunds every FEFO part atomically and only once", async () => {
    const baseline = Date.now();
    const earlyExpiry = new Date(baseline + 5 * 24 * 60 * 60 * 1000);
    const laterExpiry = new Date(baseline + 30 * 24 * 60 * 60 * 1000);

    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 5,
      order_no: "early-order",
      expired_at: earlyExpiry,
      actor: "stripe:webhook",
    });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 10,
      order_no: "later-order",
      expired_at: laterExpiry,
      actor: "stripe:webhook",
    });
    const spendTransNo = await decreaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.TaskTextToVideo,
      credits: 8,
      actor: `user:${USER}`,
    });

    const [first, second] = await Promise.all([
      refundCreditsForTransaction({
        org_uuid: ORG,
        user_uuid: USER,
        original_trans_no: spendTransNo,
      }),
      refundCreditsForTransaction({
        org_uuid: ORG,
        user_uuid: USER,
        original_trans_no: spendTransNo,
      }),
    ]);

    expect(first).toBe(`refund_${spendTransNo}`);
    expect(second).toBe(first);

    const rows = await ledgerRows();
    const refunds = rows.filter(
      (row) =>
        row.trans_no === first || row.trans_no.startsWith(`${first}:part:`),
    );
    expect(refunds.map((row) => row.credits)).toEqual([5, 3]);
    expect(refunds.map((row) => row.expired_at?.getTime())).toEqual([
      earlyExpiry.getTime(),
      laterExpiry.getTime(),
    ]);
    expect(rows).toHaveLength(6);
    let runningBalance = 0;
    for (const row of rows) {
      runningBalance += row.credits;
      expect(row.balance_after).toBe(runningBalance);
    }
    expect((await getOrgCreditSummary(ORG)).balance).toBe(15);

    const afterEarlyExpiry = calculateCreditBalance(
      rows,
      new Date(baseline + 10 * 24 * 60 * 60 * 1000),
    );
    expect(afterEarlyExpiry.available).toBe(10);
  });

  it("refunds a spend once, however many times it is retried", async () => {
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 100,
      actor: "system:test",
    });
    const spendTransNo = await decreaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.TaskTextToVideo,
      credits: 40,
      actor: `user:${USER}`,
    });

    const first = await refundCreditsForTransaction({
      org_uuid: ORG,
      user_uuid: USER,
      original_trans_no: spendTransNo,
    });
    const second = await refundCreditsForTransaction({
      org_uuid: ORG,
      user_uuid: USER,
      original_trans_no: spendTransNo,
    });

    expect(second).toBe(first);
    expect(await countRows()).toBe(3);
    expect((await getOrgCreditSummary(ORG)).balance).toBe(100);
  });

  it("refuses to refund a transaction belonging to another organization", async () => {
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 50,
      actor: "system:test",
    });
    const spendTransNo = await decreaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.Ping,
      credits: 5,
      actor: `user:${USER}`,
    });

    await expect(
      refundCreditsForTransaction({
        org_uuid: "some-other-org",
        user_uuid: USER,
        original_trans_no: spendTransNo,
      }),
    ).rejects.toThrow(/does not belong/i);
  });

  it("never reports a negative spendable balance", async () => {
    // getOrgCredits floors at zero for display; the ledger itself may still go
    // negative through an admin adjustment, and the two must not disagree.
    await db().insert(creditsTable).values({
      trans_no: "manual-negative",
      created_at: new Date(),
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.TaskAdjust,
      credits: -25,
      order_no: "",
    });

    const status = await getOrgCredits(ORG);

    expect(status.left_credits).toBe(0);
    expect(status.is_pro).toBe(false);
  });

  // ------------------------------------------------------------------- audit
  // `balance_after`, `actor`, `metadata_json` — migration 0018.

  it("stamps a running balance on every row it writes", async () => {
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 100,
      actor: "system:test",
    });
    await decreaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.Ping,
      credits: 30,
      actor: `user:${USER}`,
    });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 5,
      actor: "system:test",
    });

    const rows = await ledgerRows();

    expect(rows.map((row) => row.balance_after)).toEqual([100, 70, 75]);
  });

  it("keeps the running balance consistent under concurrent grants", async () => {
    // The point of the column, and the reason it needs the org lock. Without
    // one, both grants read a total of 0 and both stamp 10 — a ledger that sums
    // to 20 while claiming to have never exceeded 10. Nothing throws; the
    // corruption is only visible by reading the rows back, which is what this
    // does.
    await Promise.all([
      increaseCredits({
        org_uuid: ORG,
        user_uuid: USER,
        trans_type: CreditsTransType.SystemAdd,
        credits: 10,
        trans_no: "concurrent-a",
        actor: "system:test",
      }),
      increaseCredits({
        org_uuid: ORG,
        user_uuid: USER,
        trans_type: CreditsTransType.SystemAdd,
        credits: 10,
        trans_no: "concurrent-b",
        actor: "system:test",
      }),
    ]);

    const rows = await ledgerRows();

    expect(rows).toHaveLength(2);
    // Order is whichever won the lock, so assert the set rather than a sequence.
    expect(
      rows.map((row) => row.balance_after).sort((a, b) => a! - b!),
    ).toEqual([10, 20]);

    // The invariant a reconciliation script checks, stated directly.
    let running = 0;
    for (const row of rows) {
      running += row.credits;
      expect(row.balance_after).toBe(running);
    }
  });

  it("counts expired grants in the running balance but not in the spendable one", async () => {
    // The distinction the column exists on. Expiry moves the spendable balance
    // without writing a row, so `balance_after` tracks the ledger total instead
    // — otherwise every expiry would look like drift to a script that cannot
    // see the clock.
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 50,
      expired_at: daysFromNow(-1),
      actor: "stripe:webhook",
    });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 20,
      expired_at: daysFromNow(30),
      actor: "stripe:webhook",
    });

    const rows = await ledgerRows();

    expect(rows.map((row) => row.balance_after)).toEqual([50, 70]);
    expect((await getOrgCreditSummary(ORG)).balance).toBe(20);
  });

  it("records who caused a movement, separately from who it credits", async () => {
    // An admin grant and a Stripe payment are indistinguishable by trans_type
    // alone — both can be SystemAdd/OrderPay against the same user — so this is
    // the only column that answers "did someone pay for this".
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 30,
      trans_no: "by-admin",
      actor: "admin:admin-uuid-1",
    });
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.OrderPay,
      credits: 40,
      trans_no: "by-stripe",
      actor: "stripe:webhook",
    });

    const rows = await ledgerRows();

    expect(rows.map((row) => row.actor)).toEqual([
      "admin:admin-uuid-1",
      "stripe:webhook",
    ]);
    // The recipient is unchanged by who acted — the two columns must not be
    // conflated, which is the mistake this pair of assertions pins down.
    expect(rows.every((row) => row.user_uuid === USER)).toBe(true);
  });

  it("stores metadata as JSON, and records what a refund reverses", async () => {
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 100,
      actor: "system:test",
      metadata: { reason: "test seed" },
    });
    const spendTransNo = await decreaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.TaskTextToVideo,
      credits: 40,
      actor: `user:${USER}`,
      metadata: { task_uuid: "task-1" },
    });
    await refundCreditsForTransaction({
      org_uuid: ORG,
      user_uuid: USER,
      original_trans_no: spendTransNo,
    });

    const [grant, spend, refund] = await ledgerRows();

    expect(JSON.parse(grant!.metadata_json!)).toEqual({ reason: "test seed" });
    expect(JSON.parse(spend!.metadata_json!)).toEqual({ task_uuid: "task-1" });
    expect(JSON.parse(refund!.metadata_json!)).toEqual({
      reverses_trans_no: spendTransNo,
      reverses_trans_type: CreditsTransType.TaskTextToVideo,
    });
    expect(refund!.actor).toBe("system:credit_refund");
  });

  it("withholds actor and metadata from a caller that did not ask for them", async () => {
    // `getOrgCreditSummary` feeds both the customer's own account page and the
    // admin console. `actor` can name an admin by uuid and `metadata` carries
    // Stripe event ids and idempotency keys — so the default has to be the safe
    // one, and a new customer-facing caller must not inherit the internal fields
    // by widening a shared DTO.
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 40,
      actor: "admin:admin-uuid-9",
      metadata: { idempotency_key: "secret-key" },
    });

    const summary = await getOrgCreditSummary(ORG);
    const [row] = summary.ledger;

    expect(row).toBeDefined();
    expect(row!.actor).toBeUndefined();
    expect(row!.metadata).toBeUndefined();
    // The running balance is the org's own number, so it is not withheld — a
    // ledger whose arithmetic you cannot check is one you have to take on faith.
    expect(row!.balanceAfter).toBe(40);
    // Belt and braces: nothing anywhere in the serialized response.
    expect(JSON.stringify(summary)).not.toContain("admin-uuid-9");
    expect(JSON.stringify(summary)).not.toContain("secret-key");
  });

  it("includes actor and metadata for an admin caller", async () => {
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 40,
      actor: "admin:admin-uuid-9",
      metadata: { idempotency_key: "grant-1" },
    });

    const summary = await getOrgCreditSummary(ORG, { includeAudit: true });
    const [row] = summary.ledger;

    expect(row!.actor).toBe("admin:admin-uuid-9");
    expect(row!.metadata).toEqual({ idempotency_key: "grant-1" });
  });

  it("survives a metadata value that is not valid JSON", async () => {
    // The column is `text`. A malformed value must not take down the whole
    // ledger view — an incident is exactly when a half-written row is most
    // likely to be the thing being looked at.
    await db().insert(creditsTable).values({
      trans_no: "bad-metadata",
      created_at: new Date(),
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 5,
      order_no: "",
      actor: "system:test",
      metadata_json: "{not json",
    });

    const summary = await getOrgCreditSummary(ORG, { includeAudit: true });

    expect(summary.balance).toBe(5);
    expect(summary.ledger[0]!.metadata).toBeNull();
  });

  it("leaves the audit columns null on a row written outside the model layer", async () => {
    // Stands in for pre-0018 history. A null means "written before this
    // existed", which a reconciliation script must treat as out of scope rather
    // than as drift — and the balance arithmetic must not care either way.
    await db().insert(creditsTable).values({
      trans_no: "legacy-row",
      created_at: new Date(),
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 15,
      order_no: "",
    });

    const [legacy] = await ledgerRows();

    expect(legacy!.balance_after).toBeNull();
    expect(legacy!.actor).toBeNull();
    expect(legacy!.metadata_json).toBeNull();
    expect((await getOrgCreditSummary(ORG)).balance).toBe(15);

    // And the next real write counts it, rather than restarting from zero.
    await increaseCredits({
      org_uuid: ORG,
      user_uuid: USER,
      trans_type: CreditsTransType.SystemAdd,
      credits: 5,
      actor: "system:test",
    });

    const rows = await ledgerRows();
    expect(rows[1]!.balance_after).toBe(20);
  });
});
