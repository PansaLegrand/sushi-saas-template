import {
  claimDueJobs,
  deleteFinishedJobsBefore,
  insertJob,
  markJobFailed,
  markJobSucceeded,
  type JobRow,
} from "@/models/job";
import { jobHandlers } from "./handlers";
import type {
  JobHandlerContext,
  JobPayloads,
  JobType,
} from "./types";
import { logger } from "@/lib/logger/server";
import { AppError } from "@/lib/errors";

export type { JobPayloads, JobType } from "./types";

/** How long a claimed job may stay locked before another runner reclaims it. */
const STALE_LOCK_MS = 5 * 60 * 1000;
/** First retry delay; doubles per attempt. */
const BACKOFF_BASE_MS = 30 * 1000;
/** Finished jobs are pruned after this long. */
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
/** Bound one provider call well below the five-minute lease window. */
const HANDLER_TIMEOUT_MS = 20 * 1000;
/** Leave headroom in the 60-second cron request for cleanup and reporting. */
const DRAIN_DEADLINE_MS = 40 * 1000;

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  dedupeKey?: string;
  subjectUserUuid?: string;
  subjectOrgUuid?: string;
  retryFailed?: boolean;
}

/**
 * Schedule work to run outside the current request.
 *
 * Prefer this over `queueMicrotask`/`setTimeout` for anything that must
 * actually happen: on serverless the instance can be frozen as soon as the
 * response is sent, silently dropping un-awaited work.
 *
 * Returns whether a job was actually created. With a `dedupeKey`, `false` means
 * an identical job already existed and this call was a no-op — which is the
 * mechanism working, not a failure. Most callers can ignore it; a caller that
 * reports "I alerted someone" cannot, because it would be claiming credit for a
 * message the dedupe key suppressed.
 */
export async function enqueueJob<T extends JobType>(
  type: T,
  payload: JobPayloads[T],
  options: EnqueueOptions = {},
): Promise<boolean> {
  const row = await insertJob({
    type,
    payload,
    runAt: options.runAt,
    maxAttempts: options.maxAttempts,
    dedupeKey: options.dedupeKey,
    subjectUserUuid: options.subjectUserUuid,
    subjectOrgUuid: options.subjectOrgUuid,
    retryFailed: options.retryFailed,
  });

  return Boolean(row);
}

/**
 * Enqueue without ever throwing into the caller's path.
 *
 * Used from auth hooks, where a queueing failure must not block a signup.
 */
export async function enqueueJobSafe<T extends JobType>(
  type: T,
  payload: JobPayloads[T],
  options: EnqueueOptions = {},
): Promise<boolean> {
  try {
    return await enqueueJob(type, payload, options);
  } catch (e) {
    logger.error({ err: e, job_type: type }, "failed to enqueue job");
    return false;
  }
}

export interface RunJobsResult {
  claimed: number;
  succeeded: number;
  retrying: number;
  failed: number;
  leaseLost: number;
  results: {
    uuid: string;
    type: string;
    outcome:
      | "succeeded"
      | "retrying"
      | "failed"
      | "unknown_type"
      | "lease_lost";
    error?: string;
  }[];
}

export interface RunJobsOptions {
  handlerTimeoutMs?: number;
  drainDeadlineMs?: number;
}

async function runWithTimeout(
  operation: () => Promise<void>,
  timeoutMs: number,
  controller: AbortController,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new AppError("SERVICE_UNAVAILABLE", {
          message: `job handler timed out after ${timeoutMs}ms`,
        }),
      );
    }, timeoutMs);
  });

  try {
    await Promise.race([operation(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runOne(
  job: JobRow,
  timeoutMs: number,
): Promise<RunJobsResult["results"][number]> {
  const handler = jobHandlers[job.type as JobType];

  if (!handler) {
    // An unknown type means a job outlived the deploy that understood it.
    // Bury it rather than retrying forever.
    const outcome = await markJobFailed(
      { ...job, attempts: job.max_attempts },
      `unknown job type: ${job.type}`,
      BACKOFF_BASE_MS,
    );
    if (outcome === "lease_lost") {
      return { uuid: job.uuid, type: job.type, outcome };
    }
    return { uuid: job.uuid, type: job.type, outcome: "unknown_type" };
  }

  try {
    const payload = job.payload_json ? JSON.parse(job.payload_json) : {};
    const controller = new AbortController();
    const context: JobHandlerContext = {
      jobUuid: job.uuid,
      attempt: job.attempts,
      maxAttempts: job.max_attempts,
      signal: controller.signal,
    };
    await runWithTimeout(
      () => handler(payload, context),
      timeoutMs,
      controller,
    );
    const completed = await markJobSucceeded(job);
    return {
      uuid: job.uuid,
      type: job.type,
      outcome: completed ? "succeeded" : "lease_lost",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const outcome = await markJobFailed(job, message, BACKOFF_BASE_MS);
    return { uuid: job.uuid, type: job.type, outcome, error: message };
  }
}

/**
 * Claim and run due jobs. Safe to call concurrently — claiming uses
 * `FOR UPDATE SKIP LOCKED`, so overlapping runs take disjoint work.
 *
 * Jobs are claimed one at a time. Preclaiming a batch and then processing it
 * sequentially strands the unstarted leases when a serverless request reaches
 * its hard deadline.
 */
export async function runDueJobs(
  limit: number = 25,
  options: RunJobsOptions = {},
): Promise<RunJobsResult> {
  const maxJobs = Math.max(0, Math.floor(limit));
  const handlerTimeoutMs = Math.max(
    1,
    Math.floor(options.handlerTimeoutMs ?? HANDLER_TIMEOUT_MS),
  );
  const drainDeadlineMs = Math.max(
    1,
    Math.floor(options.drainDeadlineMs ?? DRAIN_DEADLINE_MS),
  );
  const deadlineAt = Date.now() + drainDeadlineMs;
  const results: RunJobsResult["results"] = [];
  let claimed = 0;

  while (claimed < maxJobs && Date.now() < deadlineAt) {
    const [job] = await claimDueJobs(1, STALE_LOCK_MS);
    if (!job) break;
    claimed += 1;

    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      // The claim query itself crossed the drain deadline. Release the lease
      // through the normal retry path instead of leaving it running for five
      // minutes until stale-lock recovery.
      const message = "job drain deadline elapsed immediately after claim";
      const outcome = await markJobFailed(job, message, BACKOFF_BASE_MS);
      results.push({
        uuid: job.uuid,
        type: job.type,
        outcome,
        error: message,
      });
      break;
    }

    results.push(
      await runOne(job, Math.min(handlerTimeoutMs, remainingMs)),
    );
  }

  return {
    claimed,
    succeeded: results.filter((r) => r.outcome === "succeeded").length,
    retrying: results.filter((r) => r.outcome === "retrying").length,
    failed: results.filter(
      (r) => r.outcome === "failed" || r.outcome === "unknown_type",
    ).length,
    leaseLost: results.filter((r) => r.outcome === "lease_lost").length,
    results,
  };
}

export async function pruneFinishedJobs(): Promise<void> {
  await deleteFinishedJobsBefore(new Date(Date.now() - RETENTION_MS));
}
