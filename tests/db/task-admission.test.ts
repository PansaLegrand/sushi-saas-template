/** Real transactions prove quota/debit/dispatch atomicity and crash recovery. */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";

import { db } from "@/db";
import { jobs, tasks, users } from "@/db/schema";
import {
  admitPaidTask,
  type TaskAdmissionInput,
} from "@/models/task-admission";
import { insertTaskForIdempotencyKey } from "@/models/task";
import {
  CreditsTransType,
  decreaseCredits,
  getOrgCreditSummary,
  increaseCredits,
} from "@/services/credit";
import { ensurePersonalOrganization } from "@/services/organizations";
import { reconcilePaidTaskDispatch } from "@/services/tasks/reconcile";
import { runTextToVideoTask } from "@/services/tasks";
import { resetEnvCacheForTests } from "@/lib/env";
import { describeDb, useCleanDatabase } from "./setup";

describeDb("atomic task admission", () => {
  useCleanDatabase();
  let orgUuid: string;
  let userUuid: string;

  beforeEach(async () => {
    const id = randomUUID();
    userUuid = randomUUID();
    await db()
      .insert(users)
      .values({
        id,
        uuid: userUuid,
        email: `${id}@example.test`,
        signin_provider: "credential",
      });
    orgUuid = (await ensurePersonalOrganization({ id })).uuid;
  });

  function intent(key = randomUUID()): TaskAdmissionInput {
    return {
      task: {
        uuid: randomUUID(),
        org_uuid: orgUuid,
        user_uuid: userUuid,
        type: "image_generation",
        status: "pending_payment",
        credits_used: 5,
        idempotency_key: key,
        request_fingerprint: "same-request",
        user_input: '{"prompt":"test"}',
        created_at: new Date(),
        updated_at: new Date(Date.now() - 10 * 60_000),
      },
      maxTasks: 1,
      since: new Date(0),
      spendPrefix: "task_image",
      transType: CreditsTransType.TaskImageGeneration,
      maxAttempts: 8,
    };
  }

  async function fund(amount: number) {
    await increaseCredits({
      org_uuid: orgUuid,
      user_uuid: userUuid,
      trans_type: CreditsTransType.SystemAdd,
      credits: amount,
      actor: "system:test",
    });
  }

  it("admits only one of two concurrent requests for the last monthly slot", async () => {
    await fund(10);
    const results = await Promise.all([
      admitPaidTask(intent()),
      admitPaidTask(intent()),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      reason: "quota",
      current: 1,
    });
    expect((await getOrgCreditSummary(orgUuid)).balance).toBe(5);
    expect(await db().$count(tasks)).toBe(1);
    expect(await db().$count(jobs)).toBe(1);
  });

  it("replays concurrent identical calls after the final credits and quota are spent", async () => {
    await fund(5);
    const input = intent();
    const results = await Promise.all([
      admitPaidTask(input),
      admitPaidTask(input),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && r.replayed)).toHaveLength(1);
    expect(await db().$count(tasks)).toBe(1);
    expect(await db().$count(jobs)).toBe(1);
    expect((await getOrgCreditSummary(orgUuid)).balance).toBe(0);
    expect(await admitPaidTask({ ...input, maxTasks: 0 })).toMatchObject({
      ok: true,
      replayed: true,
    });
  });

  it("rejects changed input without another debit", async () => {
    await fund(10);
    const input = intent();
    await admitPaidTask(input);
    await expect(
      admitPaidTask({
        ...input,
        task: { ...input.task, request_fingerprint: "different" },
      }),
    ).rejects.toMatchObject({ code: "TASK_IDEMPOTENCY_CONFLICT" });
    expect((await getOrgCreditSummary(orgUuid)).balance).toBe(5);
  });

  it("leaves no task or dispatch when credit reservation fails", async () => {
    expect(await admitPaidTask(intent())).toMatchObject({
      ok: false,
      reason: "credits",
      available: 0,
    });
    expect(await db().$count(tasks)).toBe(0);
    expect(await db().$count(jobs)).toBe(0);
  });

  it("refuses admission when erasure has already closed the account", async () => {
    await fund(10);
    await db().update(users).set({ lifecycle_status: "erasing" }).where(eq(users.uuid, userUuid));
    await expect(admitPaidTask(intent())).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(await db().$count(tasks)).toBe(0);
    expect((await getOrgCreditSummary(orgUuid)).balance).toBe(10);
  });

  it("meters an old unpaid draft in the month it is funded", async () => {
    await fund(10);
    const now = new Date();
    const since = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const input = intent();
    input.since = since;
    input.task.created_at = new Date(since.getTime() - 86_400_000);
    await insertTaskForIdempotencyKey(input.task);
    expect(await admitPaidTask(input)).toMatchObject({ ok: true });
    expect(await admitPaidTask({ ...intent(), since })).toMatchObject({
      ok: false,
      reason: "quota",
      current: 1,
    });
  });

  it("refunds a durable video failure once even when the worker is replayed", async () => {
    await fund(8);
    const input = intent();
    input.task.type = "text_to_video";
    input.task.credits_used = 8;
    input.spendPrefix = "task_video";
    input.transType = CreditsTransType.TaskTextToVideo;
    const created = await admitPaidTask(input);
    if (!created.ok) throw new Error("fixture admission failed");
    const prior = process.env.ENABLE_TEXT2VIDEO_MOCK;
    process.env.ENABLE_TEXT2VIDEO_MOCK = "false";
    resetEnvCacheForTests();
    try {
      const context = {
        jobUuid: created.task.job_uuid!,
        attempt: 1,
        maxAttempts: 8,
        signal: new AbortController().signal,
      };
      const payload = { taskUuid: created.task.uuid, orgUuid };
      await runTextToVideoTask(payload, context);
      await runTextToVideoTask(payload, context);
      const summary = await getOrgCreditSummary(orgUuid);
      expect(summary.balance).toBe(8);
      expect(
        summary.ledger.filter(
          (entry) => entry.transType === CreditsTransType.TaskTextToVideo,
        ),
      ).toHaveLength(1);
      expect(
        summary.ledger.filter(
          (entry) => entry.transType === CreditsTransType.TaskAdjust,
        ),
      ).toHaveLength(1);
    } finally {
      if (prior === undefined) delete process.env.ENABLE_TEXT2VIDEO_MOCK;
      else process.env.ENABLE_TEXT2VIDEO_MOCK = prior;
      resetEnvCacheForTests();
    }
  });

  it("rolls the debit back when queue persistence fails", async () => {
    await fund(5);
    await db().execute(
      sql`create function reject_test_dispatch() returns trigger language plpgsql as $$ begin raise exception 'dispatch unavailable'; end; $$`,
    );
    await db().execute(
      sql`create trigger reject_test_dispatch before insert on jobs for each row execute function reject_test_dispatch()`,
    );
    try {
      await expect(admitPaidTask(intent())).rejects.toThrow();
      expect((await getOrgCreditSummary(orgUuid)).balance).toBe(5);
      expect(await db().$count(tasks)).toBe(0);
      expect(await db().$count(jobs)).toBe(0);
    } finally {
      await db().execute(sql`drop trigger reject_test_dispatch on jobs`);
      await db().execute(sql`drop function reject_test_dispatch()`);
    }
  });

  it("repairs a legacy charged intent without browser replay or charging unpaid drafts", async () => {
    await fund(10);
    const paid = intent();
    await insertTaskForIdempotencyKey(paid.task);
    await insertTaskForIdempotencyKey(intent().task);
    await decreaseCredits({
      org_uuid: orgUuid,
      user_uuid: userUuid,
      credits: 5,
      trans_no: `task_image:${paid.task.uuid}`,
      trans_type: CreditsTransType.TaskImageGeneration,
      actor: `user:${userUuid}`,
    });
    expect(await reconcilePaidTaskDispatch()).toBe(1);
    expect(await db().$count(jobs)).toBe(1);
    expect((await getOrgCreditSummary(orgUuid)).balance).toBe(5);
    const [task] = await db()
      .select()
      .from(tasks)
      .where(eq(tasks.uuid, paid.task.uuid));
    expect(task).toMatchObject({
      status: "queued",
      credits_trans_no: `task_image:${paid.task.uuid}`,
      job_uuid: expect.any(String),
    });
  });

  it("revives failed dispatch but never changes a running lease", async () => {
    await fund(5);
    const input = intent();
    const result = await admitPaidTask(input);
    if (!result.ok) throw new Error("fixture admission failed");
    const jobUuid = result.task.job_uuid!;
    await db()
      .update(jobs)
      .set({ status: "failed", attempts: 8 })
      .where(eq(jobs.uuid, jobUuid));
    await admitPaidTask(input);
    const [pending] = await db()
      .select()
      .from(jobs)
      .where(eq(jobs.uuid, jobUuid));
    expect(pending).toMatchObject({ status: "pending", attempts: 0 });
    const lockedAt = new Date();
    await db()
      .update(jobs)
      .set({ status: "running", attempts: 1, locked_at: lockedAt })
      .where(eq(jobs.uuid, jobUuid));
    await admitPaidTask(input);
    const [running] = await db()
      .select()
      .from(jobs)
      .where(eq(jobs.uuid, jobUuid));
    expect(running).toMatchObject({
      status: "running",
      attempts: 1,
      locked_at: lockedAt,
    });
    expect((await getOrgCreditSummary(orgUuid)).balance).toBe(0);
  });
});
