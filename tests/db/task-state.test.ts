/**
 * Database tier: durable task state and relationships.
 *
 * A worker retry, manual SQL edit, or retention pass bypasses TypeScript's
 * unions. These tests pin the PostgreSQL constraints that keep unsupported
 * lifecycle states and orphaned task artifacts out of the database.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";

import { db } from "@/db";
import { jobs, tasks } from "@/db/schema";
import { insertJob } from "@/models/job";

import {
  CHECK_VIOLATION,
  describeDb,
  expectConstraintViolation,
  FOREIGN_KEY_VIOLATION,
  useCleanDatabase,
} from "./setup";

function taskValues(overrides: Partial<typeof tasks.$inferInsert> = {}) {
  return {
    uuid: randomUUID(),
    user_uuid: randomUUID(),
    org_uuid: randomUUID(),
    type: "image_generation",
    status: "pending_payment",
    ...overrides,
  } satisfies typeof tasks.$inferInsert;
}

describeDb("task state constraints (real database)", () => {
  useCleanDatabase();

  it("rejects unsupported task states and negative credit costs", async () => {
    await expectConstraintViolation(
      db().insert(tasks).values(taskValues({ status: "finished" })),
      CHECK_VIOLATION,
      "tasks_status_check",
    );

    await expectConstraintViolation(
      db().insert(tasks).values(taskValues({ credits_used: -1 })),
      CHECK_VIOLATION,
      "tasks_credits_used_check",
    );
  });

  it("rejects task links to ledger, queue, or file rows that do not exist", async () => {
    await expectConstraintViolation(
      db()
        .insert(tasks)
        .values(taskValues({ credits_trans_no: `missing-${randomUUID()}` })),
      FOREIGN_KEY_VIOLATION,
      "tasks_credits_trans_no_credits_trans_no_fk",
    );

    await expectConstraintViolation(
      db()
        .insert(tasks)
        .values(taskValues({ job_uuid: `missing-${randomUUID()}` })),
      FOREIGN_KEY_VIOLATION,
      "tasks_job_uuid_jobs_uuid_fk",
    );

    await expectConstraintViolation(
      db()
        .insert(tasks)
        .values(taskValues({ output_file_uuid: `missing-${randomUUID()}` })),
      FOREIGN_KEY_VIOLATION,
      "tasks_output_file_uuid_files_uuid_fk",
    );
  });

  it("clears the task's diagnostic job link when retention removes the job", async () => {
    const job = await insertJob({
      type: "image_generation",
      payload: { taskUuid: "task-1" },
      dedupeKey: `image_generation:${randomUUID()}`,
    });
    const taskUuid = randomUUID();

    await db()
      .insert(tasks)
      .values(taskValues({ uuid: taskUuid, job_uuid: job!.uuid }));
    await db().delete(jobs).where(eq(jobs.uuid, job!.uuid));

    const [task] = await db()
      .select({ jobUuid: tasks.job_uuid })
      .from(tasks)
      .where(eq(tasks.uuid, taskUuid));
    expect(task?.jobUuid).toBeNull();
  });

  it("rejects invalid queue states and attempt bounds", async () => {
    await expectConstraintViolation(
      db().insert(jobs).values({
        uuid: randomUUID(),
        type: "image_generation",
        status: "waiting",
      }),
      CHECK_VIOLATION,
      "jobs_status_check",
    );

    await expectConstraintViolation(
      db().insert(jobs).values({
        uuid: randomUUID(),
        type: "image_generation",
        max_attempts: 0,
      }),
      CHECK_VIOLATION,
      "jobs_max_attempts_check",
    );
  });
});
