import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobs } from "@/db/schema";

export type JobStatus = "pending" | "running" | "succeeded" | "failed";

export interface EnqueueJobParams {
  type: string;
  payload?: unknown;
  /** Earliest time the job may run. Defaults to now. */
  runAt?: Date;
  maxAttempts?: number;
  /**
   * Makes enqueueing idempotent. A second enqueue with the same key is a no-op
   * rather than a duplicate job.
   */
  dedupeKey?: string;
}

export type JobRow = typeof jobs.$inferSelect;

/**
 * Insert a job. Returns the row, or undefined when `dedupeKey` matched an
 * existing job and nothing was inserted.
 */
export async function insertJob(
  params: EnqueueJobParams
): Promise<JobRow | undefined> {
  const values = {
    uuid: randomUUID(),
    type: params.type,
    payload_json:
      params.payload === undefined ? null : JSON.stringify(params.payload),
    run_at: params.runAt ?? new Date(),
    max_attempts: params.maxAttempts ?? 5,
    dedupe_key: params.dedupeKey ?? null,
  };

  const [row] = await db()
    .insert(jobs)
    .values(values)
    .onConflictDoNothing({ target: jobs.dedupe_key })
    .returning();

  return row;
}

/**
 * Claim up to `limit` runnable jobs.
 *
 * Uses a single UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) so
 * two overlapping cron invocations cannot claim the same job.
 */
export async function claimDueJobs(
  limit: number,
  staleLockMs: number
): Promise<JobRow[]> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - staleLockMs);

  const rows = await db().execute(sql`
    update ${jobs}
    set status = 'running',
        locked_at = ${now},
        attempts = ${jobs.attempts} + 1,
        updated_at = ${now}
    where ${jobs.id} in (
      select ${jobs.id} from ${jobs}
      where (
        (${jobs.status} = 'pending' and ${jobs.run_at} <= ${now})
        or (${jobs.status} = 'running' and ${jobs.locked_at} < ${staleBefore})
      )
      order by ${jobs.run_at} asc
      limit ${limit}
      for update skip locked
    )
    returning *
  `);

  // postgres.js returns a RowList (array-like); other drivers wrap it in
  // `{ rows }`. Column names come back as-is, which matches JobRow.
  const result = rows as unknown as JobRow[] | { rows: JobRow[] };
  return Array.isArray(result) ? result : (result.rows ?? []);
}

export async function markJobSucceeded(id: number): Promise<void> {
  const now = new Date();
  await db()
    .update(jobs)
    .set({
      status: "succeeded",
      locked_at: null,
      last_error: null,
      completed_at: now,
      updated_at: now,
    })
    .where(eq(jobs.id, id));
}

/**
 * Reschedule a failed job with exponential backoff, or bury it once it has
 * exhausted its attempts.
 */
export async function markJobFailed(
  job: JobRow,
  error: string,
  backoffBaseMs: number
): Promise<"retrying" | "failed"> {
  const now = new Date();
  const exhausted = job.attempts >= job.max_attempts;

  if (exhausted) {
    await db()
      .update(jobs)
      .set({
        status: "failed",
        locked_at: null,
        last_error: error.slice(0, 4000),
        completed_at: now,
        updated_at: now,
      })
      .where(eq(jobs.id, job.id));
    return "failed";
  }

  const delayMs = backoffBaseMs * Math.pow(2, Math.max(job.attempts - 1, 0));
  await db()
    .update(jobs)
    .set({
      status: "pending",
      locked_at: null,
      last_error: error.slice(0, 4000),
      run_at: new Date(now.getTime() + delayMs),
      updated_at: now,
    })
    .where(eq(jobs.id, job.id));
  return "retrying";
}

export async function countJobsByStatus(): Promise<Record<string, number>> {
  const rows = await db()
    .select({ status: jobs.status, count: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.status);

  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

/**
 * Delete finished jobs older than the cutoff, so the table does not grow
 * without bound.
 */
export async function deleteFinishedJobsBefore(cutoff: Date): Promise<void> {
  await db()
    .delete(jobs)
    .where(
      and(
        or(eq(jobs.status, "succeeded"), eq(jobs.status, "failed")),
        isNotNull(jobs.completed_at),
        lt(jobs.completed_at, cutoff)
      )
    );
}

export async function findJobByDedupeKey(
  dedupeKey: string
): Promise<JobRow | undefined> {
  const [row] = await db()
    .select()
    .from(jobs)
    .where(eq(jobs.dedupe_key, dedupeKey))
    .limit(1);

  return row;
}

export async function listPendingJobs(limit: number = 50): Promise<JobRow[]> {
  return db()
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), lte(jobs.run_at, new Date())))
    .orderBy(asc(jobs.run_at))
    .limit(limit);
}
