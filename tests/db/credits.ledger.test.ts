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
    .values({ id, uuid, email: `ledger-${uuid}@test.dev`, signin_provider: "credential" });

  const org = await ensurePersonalOrganization({ id, email: `ledger-${uuid}@test.dev` });
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
      })
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
      })
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

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
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

    await jobHandlers.new_user_credits(payload);
    await jobHandlers.new_user_credits(payload);
    await jobHandlers.new_user_credits(payload);

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
      })
    ).rejects.toThrow(/does not belong/i);
  });

  it("never reports a negative spendable balance", async () => {
    // getOrgCredits floors at zero for display; the ledger itself may still go
    // negative through an admin adjustment, and the two must not disagree.
    await db()
      .insert(creditsTable)
      .values({
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
    expect(rows.map((row) => row.balance_after).sort((a, b) => a! - b!)).toEqual([
      10, 20,
    ]);

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
    await db()
      .insert(creditsTable)
      .values({
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
    await db()
      .insert(creditsTable)
      .values({
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
