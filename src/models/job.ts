import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobs } from "@/db/schema";

export type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export interface EnqueueJobParams {
  type: string;
  payload?: unknown;
  /** Earliest time the job may run. Defaults to now. */
  runAt?: Date;
  maxAttempts?: number;
  /** Structured subject references let privacy workflows cancel work safely. */
  subjectUserUuid?: string;
  subjectOrgUuid?: string;
  /**
   * Revive a failed job with this dedupe key. Use only for handlers whose
   * effect is idempotent and must eventually happen.
   */
  retryFailed?: boolean;
  /**
   * Makes enqueueing idempotent. A second enqueue with the same key is a no-op
   * rather than a duplicate job.
   */
  dedupeKey?: string;
}

export type JobRow = typeof jobs.$inferSelect;

function normalizeClaimedJob(row: JobRow): JobRow {
  const date = (value: Date | string): Date =>
    value instanceof Date ? value : new Date(value);
  const optionalDate = (value: Date | string | null): Date | null =>
    value == null ? null : date(value);

  // Raw `execute()` results bypass Drizzle's timestamp mapper. Normalize them
  // before `locked_at` is used as the lease token in a query-builder update.
  return {
    ...row,
    run_at: date(row.run_at as Date | string),
    locked_at: optionalDate(row.locked_at as Date | string | null),
    created_at: date(row.created_at as Date | string),
    updated_at: date(row.updated_at as Date | string),
    completed_at: optionalDate(row.completed_at as Date | string | null),
  };
}

/**
 * Insert a job. Returns the row, or undefined when `dedupeKey` matched an
 * existing job and nothing was inserted.
 */
export async function insertJob(
  params: EnqueueJobParams,
): Promise<JobRow | undefined> {
  if (params.retryFailed && params.dedupeKey) {
    const now = new Date();
    const [revived] = await db()
      .update(jobs)
      .set({
        status: "pending",
        attempts: 0,
        max_attempts: params.maxAttempts ?? 5,
        run_at: params.runAt ?? now,
        locked_at: null,
        last_error: null,
        completed_at: null,
        updated_at: now,
      })
      .where(
        and(eq(jobs.dedupe_key, params.dedupeKey), eq(jobs.status, "failed")),
      )
      .returning();

    if (revived) return revived;
  }

  const values = {
    uuid: randomUUID(),
    type: params.type,
    payload_json:
      params.payload === undefined ? null : JSON.stringify(params.payload),
    run_at: params.runAt ?? new Date(),
    max_attempts: params.maxAttempts ?? 5,
    dedupe_key: params.dedupeKey ?? null,
    subject_user_uuid: params.subjectUserUuid ?? null,
    subject_org_uuid: params.subjectOrgUuid ?? null,
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
  staleLockMs: number,
): Promise<JobRow[]> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - staleLockMs);

  // ISO strings with explicit casts, not Date objects. `db().execute()` sends a
  // raw statement down postgres.js's unsafe path, which has no type handler for
  // Date and throws "The 'string' argument must be of type string ... Received
  // an instance of Date". Drizzle's query builder converts Dates for you; this
  // template does not, so the conversion has to happen here.
  const nowIso = now.toISOString();
  const staleBeforeIso = staleBefore.toISOString();

  const rows = await db().execute(sql`
    with exhausted as (
      update ${jobs}
      set status = 'failed',
          locked_at = null,
          last_error = coalesce(
            ${jobs.last_error},
            'worker lease expired after the final attempt'
          ),
          completed_at = ${nowIso}::timestamptz,
          updated_at = ${nowIso}::timestamptz
      where ${jobs.attempts} >= ${jobs.max_attempts}
        and (
          (${jobs.status} = 'pending' and ${jobs.run_at} <= ${nowIso}::timestamptz)
          or (
            ${jobs.status} = 'running'
            and ${jobs.locked_at} < ${staleBeforeIso}::timestamptz
          )
        )
      returning ${jobs.id}
    )
    update ${jobs}
    set status = 'running',
        locked_at = ${nowIso}::timestamptz,
        attempts = ${jobs.attempts} + 1,
        updated_at = ${nowIso}::timestamptz
    where ${jobs.id} in (
      select ${jobs.id} from ${jobs}
      where ${jobs.attempts} < ${jobs.max_attempts}
        and (
          (${jobs.status} = 'pending' and ${jobs.run_at} <= ${nowIso}::timestamptz)
          or (
            ${jobs.status} = 'running'
            and ${jobs.locked_at} < ${staleBeforeIso}::timestamptz
          )
        )
      order by ${jobs.run_at} asc
      limit ${limit}
      for update skip locked
    )
    returning *
  `);

  // postgres.js returns a RowList (array-like); other drivers wrap it in
  // `{ rows }`. Column names come back as-is, while timestamp values do not.
  const result = rows as unknown as JobRow[] | { rows: JobRow[] };
  const claimed = Array.isArray(result) ? result : (result.rows ?? []);
  return claimed.map(normalizeClaimedJob);
}

/**
 * Complete only the lease represented by this row.
 *
 * `locked_at` is the lease token. A stale worker must not overwrite a newer
 * runner after the job has been reclaimed.
 */
export async function markJobSucceeded(job: JobRow): Promise<boolean> {
  if (!job.locked_at) return false;

  const now = new Date();
  const [updated] = await db()
    .update(jobs)
    .set({
      status: "succeeded",
      locked_at: null,
      last_error: null,
      completed_at: now,
      updated_at: now,
    })
    .where(
      and(
        eq(jobs.id, job.id),
        eq(jobs.status, "running"),
        eq(jobs.locked_at, job.locked_at),
      ),
    )
    .returning({ id: jobs.id });

  return Boolean(updated);
}

/**
 * Reschedule a failed job with exponential backoff, or bury it once it has
 * exhausted its attempts.
 */
export async function markJobFailed(
  job: JobRow,
  error: string,
  backoffBaseMs: number,
): Promise<"retrying" | "failed" | "lease_lost"> {
  if (!job.locked_at) return "lease_lost";

  const now = new Date();
  const exhausted = job.attempts >= job.max_attempts;
  const lease = and(
    eq(jobs.id, job.id),
    eq(jobs.status, "running"),
    eq(jobs.locked_at, job.locked_at),
  );

  if (exhausted) {
    const [updated] = await db()
      .update(jobs)
      .set({
        status: "failed",
        locked_at: null,
        last_error: error.slice(0, 4000),
        completed_at: now,
        updated_at: now,
      })
      .where(lease)
      .returning({ id: jobs.id });
    return updated ? "failed" : "lease_lost";
  }

  const delayMs = backoffBaseMs * Math.pow(2, Math.max(job.attempts - 1, 0));
  const [updated] = await db()
    .update(jobs)
    .set({
      status: "pending",
      locked_at: null,
      last_error: error.slice(0, 4000),
      run_at: new Date(now.getTime() + delayMs),
      updated_at: now,
    })
    .where(lease)
    .returning({ id: jobs.id });
  return updated ? "retrying" : "lease_lost";
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
        lt(jobs.completed_at, cutoff),
      ),
    );
}

export async function findJobByDedupeKey(
  dedupeKey: string,
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

export type JobQueueReadiness = {
  pending: number;
  running: number;
  failed: number;
  staleRunning: number;
};

/** Operational queue signals shown by readiness without exposing job payloads. */
export async function getJobQueueReadiness(
  staleBefore: Date,
): Promise<JobQueueReadiness> {
  const [row] = await db()
    .select({
      pending: sql<number>`count(*) filter (where ${jobs.status} = 'pending')::int`,
      running: sql<number>`count(*) filter (where ${jobs.status} = 'running')::int`,
      failed: sql<number>`count(*) filter (where ${jobs.status} = 'failed')::int`,
      staleRunning: sql<number>`
        count(*) filter (
          where ${jobs.status} = 'running'
            and ${jobs.locked_at} < ${staleBefore}
        )::int
      `,
    })
    .from(jobs);

  return {
    pending: row?.pending ?? 0,
    running: row?.running ?? 0,
    failed: row?.failed ?? 0,
    staleRunning: row?.staleRunning ?? 0,
  };
}
