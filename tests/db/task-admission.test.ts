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
import { reconcileImageTaskDispatch } from "@/services/tasks/image-generation";
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
    expect(await reconcileImageTaskDispatch()).toBe(1);
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
