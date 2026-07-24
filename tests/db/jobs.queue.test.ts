/**
 * Database tier: the job queue.
 *
 * `claimDueJobs` is a single `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
 * LOCKED)`. That statement is the entire concurrency story of the queue — two
 * overlapping cron invocations must take disjoint work — and it is unreachable
 * from a mocked test: `SKIP LOCKED` only has meaning when two real connections
 * contend for the same rows.
 *
 * Likewise `jobs.dedupe_key` is a UNIQUE index backing `onConflictDoNothing`.
 * Every `enqueueJobSafe(..., { dedupeKey })` call in the auth hooks depends on
 * it to keep a retried signup from sending two welcome emails.
 */
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { jobs as jobsTable } from "@/db/schema";
import {
  claimDueJobs,
  countJobsByStatus,
  deleteFinishedJobsBefore,
  findJobByDedupeKey,
  insertJob,
  listPendingJobs,
  markJobFailed,
  markJobSucceeded,
} from "@/models/job";
import { runDueJobs } from "@/services/jobs";

const STALE_LOCK_MS = 5 * 60 * 1000;
const BACKOFF_BASE_MS = 30 * 1000;

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

async function rowByUuid(uuid: string) {
  const [row] = await db()
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.uuid, uuid))
    .limit(1);
  return row;
}

describeDb("job queue (real database)", () => {
  useCleanDatabase();

  it("drops a duplicate enqueue with the same dedupe key", async () => {
    const first = await insertJob({
      type: "welcome_email",
      payload: { email: "a@test.dev" },
      dedupeKey: "welcome_email:u-1",
    });
    const second = await insertJob({
      type: "welcome_email",
      payload: { email: "a@test.dev" },
      dedupeKey: "welcome_email:u-1",
    });

    expect(first).toBeDefined();
    // `onConflictDoNothing` returns no row rather than throwing — the caller
    // treats "already queued" as success.
    expect(second).toBeUndefined();
    expect(await listPendingJobs()).toHaveLength(1);
    expect((await findJobByDedupeKey("welcome_email:u-1"))?.uuid).toBe(
      first?.uuid
    );
  });

  it("allows many jobs with no dedupe key", async () => {
    await insertJob({ type: "welcome_email", payload: { email: "a@test.dev" } });
    await insertJob({ type: "welcome_email", payload: { email: "b@test.dev" } });

    // A unique index over a nullable column must not collapse NULLs, or every
    // un-deduped job after the first would be silently dropped.
    expect(await listPendingJobs()).toHaveLength(2);
  });

  it("claims only jobs whose run_at has arrived", async () => {
    const due = await insertJob({ type: "welcome_email", payload: {} });
    await insertJob({
      type: "welcome_email",
      payload: {},
      runAt: minutesFromNow(10),
    });

    const claimed = await claimDueJobs(25, STALE_LOCK_MS);

    expect(claimed.map((j) => j.uuid)).toEqual([due?.uuid]);
    expect(claimed[0]?.status).toBe("running");
    expect(claimed[0]?.attempts).toBe(1);
  });

  it("gives overlapping runners disjoint work", async () => {
    for (let i = 0; i < 8; i += 1) {
      await insertJob({ type: "welcome_email", payload: { i } });
    }

    // Two concurrent claims, as two cron invocations would overlap. The split
    // is timing-dependent; the invariant is that no job lands in both.
    const [a, b] = await Promise.all([
      claimDueJobs(8, STALE_LOCK_MS),
      claimDueJobs(8, STALE_LOCK_MS),
    ]);

    const ids = [...a, ...b].map((j) => j.uuid);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(8);
  });

  it("does not re-claim a job another runner already holds", async () => {
    await insertJob({ type: "welcome_email", payload: {} });

    const first = await claimDueJobs(25, STALE_LOCK_MS);
    const second = await claimDueJobs(25, STALE_LOCK_MS);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("reclaims a job whose runner died mid-flight", async () => {
    const job = await insertJob({ type: "welcome_email", payload: {} });
    await claimDueJobs(25, STALE_LOCK_MS);

    // Simulate a runner that was frozen after claiming: status stays `running`
    // and the lock ages out.
    await db()
      .update(jobsTable)
      .set({ locked_at: new Date(Date.now() - STALE_LOCK_MS - 1000) })
      .where(eq(jobsTable.uuid, job!.uuid));

    const reclaimed = await claimDueJobs(25, STALE_LOCK_MS);

    expect(reclaimed.map((j) => j.uuid)).toEqual([job?.uuid]);
    expect(reclaimed[0]?.attempts).toBe(2);
  });

  it("reschedules a failure with backoff, then buries it", async () => {
    const job = await insertJob({
      type: "welcome_email",
      payload: {},
      maxAttempts: 2,
    });

    const [firstAttempt] = await claimDueJobs(25, STALE_LOCK_MS);
    const firstOutcome = await markJobFailed(
      firstAttempt,
      "smtp timeout",
      BACKOFF_BASE_MS
    );

    expect(firstOutcome).toBe("retrying");
    const retried = await rowByUuid(job!.uuid);
    expect(retried?.status).toBe("pending");
    expect(retried?.locked_at).toBeNull();
    expect(retried?.last_error).toBe("smtp timeout");
    expect(retried!.run_at.getTime()).toBeGreaterThan(Date.now());

    // Backoff pushed run_at into the future, so it is no longer due.
    expect(await claimDueJobs(25, STALE_LOCK_MS)).toHaveLength(0);

    await db()
      .update(jobsTable)
      .set({ run_at: new Date() })
      .where(eq(jobsTable.uuid, job!.uuid));

    const [secondAttempt] = await claimDueJobs(25, STALE_LOCK_MS);
    const secondOutcome = await markJobFailed(
      secondAttempt,
      "smtp timeout",
      BACKOFF_BASE_MS
    );

    expect(secondOutcome).toBe("failed");
    expect((await rowByUuid(job!.uuid))?.status).toBe("failed");
  });

  it("buries a job whose type no longer exists in this deploy", async () => {
    await insertJob({ type: "removed_in_a_later_release", payload: {} });

    const result = await runDueJobs();

    expect(result.claimed).toBe(1);
    expect(result.results[0]?.outcome).toBe("unknown_type");
    expect(await countJobsByStatus()).toMatchObject({ failed: 1 });
  });

  it("prunes finished jobs past the retention window but keeps live ones", async () => {
    const done = await insertJob({ type: "welcome_email", payload: {} });
    const pending = await insertJob({
      type: "welcome_email",
      payload: {},
      dedupeKey: "keep-me",
    });

    await markJobSucceeded(done!.id);
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db()
      .update(jobsTable)
      .set({ completed_at: longAgo })
      .where(eq(jobsTable.uuid, done!.uuid));

    await deleteFinishedJobsBefore(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));

    expect(await rowByUuid(done!.uuid)).toBeUndefined();
    expect(await rowByUuid(pending!.uuid)).toBeDefined();
  });
});
