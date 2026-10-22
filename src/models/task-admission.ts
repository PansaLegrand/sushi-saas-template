import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { credits, jobs, organizations, orgMembers, tasks, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { lockOrgAndSumLedger, spendCreditInTransaction } from "./credit";
import { scopedToOrg } from "./organization";
import { countTasksByOrgSince, type TaskInsert, type TaskRow } from "./task";

export type TaskAdmissionInput = {
  task: TaskInsert & {
    uuid: string;
    type: string;
    credits_used: number;
    idempotency_key: string;
    request_fingerprint: string;
  };
  maxTasks: number | null;
  since: Date;
  spendPrefix: string;
  transType: string;
  maxAttempts: number;
  /** Repair only paid legacy intents; maintenance must never initiate a debit. */
  repairOnly?: boolean;
};

export type TaskAdmissionOutcome =
  | { ok: true; task: TaskRow; replayed: boolean }
  | { ok: false; reason: "quota"; current: number }
  | { ok: false; reason: "credits"; available: number }
  | { ok: false; reason: "unpaid" };

/** Quota, debit, task and dispatch share one transaction and organization lock. */
export async function admitPaidTask(
  input: TaskAdmissionInput,
): Promise<TaskAdmissionOutcome> {
  return db().transaction(async (tx) => {
    const data = input.task;
    // Keep erasure and membership removal from crossing the admission commit.
    // Their owning transactions lock these same identity/organization rows.
    const [user] = await tx.select({ id: users.id, state: users.lifecycle_status })
      .from(users).where(eq(users.uuid, data.user_uuid)).for("share");
    if (!user || user.state === "erasing") throw new AppError("AUTH_REQUIRED");
    const [organization] = await tx.select({ id: organizations.id, state: organizations.lifecycle_status })
      .from(organizations).where(eq(organizations.uuid, data.org_uuid)).for("share");
    if (!organization || organization.state !== "active") throw new AppError("AUTH_FORBIDDEN");
    const [membership] = await tx.select({ id: orgMembers.id }).from(orgMembers).where(and(
      eq(orgMembers.organization_id, organization.id), eq(orgMembers.user_id, user.id),
    )).limit(1);
    if (!membership) throw new AppError("AUTH_FORBIDDEN");
    await lockOrgAndSumLedger(tx, data.org_uuid);
    const [existing] = await tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.user_uuid, data.user_uuid),
          eq(tasks.type, data.type),
          eq(tasks.idempotency_key, data.idempotency_key),
        ),
      )
      .limit(1);
    if (
      existing &&
      (existing.org_uuid !== data.org_uuid ||
        existing.request_fingerprint !== data.request_fingerprint)
    ) {
      throw new AppError("TASK_IDEMPOTENCY_CONFLICT");
    }
    if (existing && ["succeeded", "failed"].includes(existing.status)) {
      return { ok: true, task: existing, replayed: true };
    }

    const task = existing ?? data;
    const transNo = `${input.spendPrefix}:${task.uuid}`;
    if (task.credits_trans_no && task.credits_trans_no !== transNo) {
      throw new AppError("TASK_CREATE_FAILED", {
        message: "task credit identity differs",
      });
    }
    const [paid] = await tx
      .select({ transNo: credits.trans_no })
      .from(credits)
      .where(
        and(
          eq(credits.trans_no, transNo),
          scopedToOrg(credits.org_uuid, data.org_uuid),
        ),
      )
      .limit(1);
    if (input.repairOnly && !paid) return { ok: false, reason: "unpaid" };
    if (!paid && input.maxTasks !== null) {
      const current = await countTasksByOrgSince(
        data.org_uuid,
        input.since,
        tx,
      );
      if (current >= input.maxTasks)
        return { ok: false, reason: "quota", current };
    }

    const spend = await spendCreditInTransaction(tx, {
      org_uuid: data.org_uuid,
      user_uuid: task.user_uuid,
      trans_no: transNo,
      trans_type: input.transType,
      credits: task.credits_used!,
      actor: `user:${task.user_uuid}`,
      created_at: new Date(),
      metadata_json: JSON.stringify({
        task_uuid: task.uuid,
        task_type: task.type,
      }),
    });
    if (!spend.ok)
      return { ok: false, reason: "credits", available: spend.available };

    const dedupeKey = `task_${task.type}:${task.uuid}`;
    const now = new Date();
    await tx
      .insert(jobs)
      .values({
        uuid: randomUUID(),
        type: task.type,
        payload_json: JSON.stringify({
          taskUuid: task.uuid,
          orgUuid: task.org_uuid,
        }),
        dedupe_key: dedupeKey,
        max_attempts: input.maxAttempts,
        subject_user_uuid: task.user_uuid,
        subject_org_uuid: task.org_uuid,
      })
      .onConflictDoNothing({ target: jobs.dedupe_key });
    // A failed dispatch can be repaired; terminal tasks returned above. A
    // pending/running lease is never reset by a replay or maintenance sweep.
    await tx
      .update(jobs)
      .set({
        status: "pending",
        attempts: 0,
        run_at: now,
        locked_at: null,
        last_error: null,
        completed_at: null,
        updated_at: now,
      })
      .where(and(eq(jobs.dedupe_key, dedupeKey), eq(jobs.status, "failed")));
    const [job] = await tx
      .select({ uuid: jobs.uuid })
      .from(jobs)
      .where(eq(jobs.dedupe_key, dedupeKey));
    const fields = {
      credits_trans_no: transNo,
      job_uuid: job.uuid,
      status: task.status === "pending_payment" ? "queued" : task.status,
      updated_at: now,
    };
    const [admitted] = existing
      ? await tx
          .update(tasks)
          .set(fields)
          .where(eq(tasks.id, existing.id))
          .returning()
      : await tx
          .insert(tasks)
          .values({ ...data, ...fields })
          .returning();
    return { ok: true, task: admitted, replayed: Boolean(existing) };
  });
}

/** Bounded recovery scan; account erasure owns work for erasing subjects. */
export async function listTaskDispatchRepairs(
  before: Date,
  limit = 50,
): Promise<TaskRow[]> {
  return db()
    .select({ task: tasks })
    .from(tasks)
    .innerJoin(users, eq(users.uuid, tasks.user_uuid))
    .innerJoin(organizations, eq(organizations.uuid, tasks.org_uuid))
    .leftJoin(jobs, eq(jobs.uuid, tasks.job_uuid))
    .where(
      and(
        inArray(tasks.type, ["image_generation", "text_to_video"]),
        inArray(tasks.status, [
          "pending_payment",
          "queued",
          "running",
          "refunding",
        ]),
        lt(tasks.updated_at, before),
        ne(users.lifecycle_status, "erasing"),
        eq(organizations.lifecycle_status, "active"),
        sql`(${jobs.uuid} is null or ${jobs.status} = 'failed')`,
      ),
    )
    .orderBy(tasks.updated_at, tasks.id)
    .limit(limit)
    .then((rows) => rows.map(({ task }) => task));
}
