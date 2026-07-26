import {
  claimDueJobs,
  deleteFinishedJobsBefore,
  insertJob,
  markJobFailed,
  markJobSucceeded,
  type JobRow,
} from "@/models/job";
import { jobHandlers } from "./handlers";
import type { JobPayloads, JobType } from "./types";
import { logger } from "@/lib/logger/server";

export type { JobPayloads, JobType } from "./types";

/** How long a claimed job may stay locked before another runner reclaims it. */
const STALE_LOCK_MS = 5 * 60 * 1000;
/** First retry delay; doubles per attempt. */
const BACKOFF_BASE_MS = 30 * 1000;
/** Finished jobs are pruned after this long. */
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  dedupeKey?: string;
}

/**
 * Schedule work to run outside the current request.
 *
 * Prefer this over `queueMicrotask`/`setTimeout` for anything that must
 * actually happen: on serverless the instance can be frozen as soon as the
 * response is sent, silently dropping un-awaited work.
 */
export async function enqueueJob<T extends JobType>(
  type: T,
  payload: JobPayloads[T],
  options: EnqueueOptions = {}
): Promise<void> {
  await insertJob({
    type,
    payload,
    runAt: options.runAt,
    maxAttempts: options.maxAttempts,
    dedupeKey: options.dedupeKey,
  });
}

/**
 * Enqueue without ever throwing into the caller's path.
 *
 * Used from auth hooks, where a queueing failure must not block a signup.
 */
export async function enqueueJobSafe<T extends JobType>(
  type: T,
  payload: JobPayloads[T],
  options: EnqueueOptions = {}
): Promise<void> {
  try {
    await enqueueJob(type, payload, options);
  } catch (e) {
    logger.error({ err: e, job_type: type }, "failed to enqueue job");
  }
}

export interface RunJobsResult {
  claimed: number;
  succeeded: number;
  retrying: number;
  failed: number;
  results: {
    uuid: string;
    type: string;
    outcome: "succeeded" | "retrying" | "failed" | "unknown_type";
    error?: string;
  }[];
}

async function runOne(job: JobRow): Promise<RunJobsResult["results"][number]> {
  const handler = jobHandlers[job.type as JobType];

  if (!handler) {
    // An unknown type means a job outlived the deploy that understood it.
    // Bury it rather than retrying forever.
    await markJobFailed(
      { ...job, attempts: job.max_attempts },
      `unknown job type: ${job.type}`,
      BACKOFF_BASE_MS
    );
    return { uuid: job.uuid, type: job.type, outcome: "unknown_type" };
  }

  try {
    const payload = job.payload_json ? JSON.parse(job.payload_json) : {};
    await handler(payload);
    await markJobSucceeded(job.id);
    return { uuid: job.uuid, type: job.type, outcome: "succeeded" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const outcome = await markJobFailed(job, message, BACKOFF_BASE_MS);
    return { uuid: job.uuid, type: job.type, outcome, error: message };
  }
}

/**
 * Claim and run due jobs. Safe to call concurrently — claiming uses
 * `FOR UPDATE SKIP LOCKED`, so overlapping runs take disjoint work.
 */
export async function runDueJobs(limit: number = 25): Promise<RunJobsResult> {
  const claimed = await claimDueJobs(limit, STALE_LOCK_MS);

  const results: RunJobsResult["results"] = [];
  // Sequential on purpose: a cron invocation has a bounded time budget and
  // handlers hit rate-limited third parties.
  for (const job of claimed) {
    results.push(await runOne(job));
  }

  return {
    claimed: claimed.length,
    succeeded: results.filter((r) => r.outcome === "succeeded").length,
    retrying: results.filter((r) => r.outcome === "retrying").length,
    failed: results.filter(
      (r) => r.outcome === "failed" || r.outcome === "unknown_type"
    ).length,
    results,
  };
}

export async function pruneFinishedJobs(): Promise<void> {
  await deleteFinishedJobsBefore(new Date(Date.now() - RETENTION_MS));
}
