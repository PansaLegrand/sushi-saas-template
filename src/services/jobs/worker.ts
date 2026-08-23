import { logger } from "@/lib/logger/server";

import { pruneFinishedJobs, runDueJobs } from "./index";

export interface JobWorkerOptions {
  signal: AbortSignal;
  pollIntervalMs?: number;
  batchSize?: number;
  handlerTimeoutMs?: number;
  drainDeadlineMs?: number;
  pruneIntervalMs?: number;
  once?: boolean;
}

export interface JobWorkerDependencies {
  run: typeof runDueJobs;
  prune: typeof pruneFinishedJobs;
  now: () => number;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_HANDLER_TIMEOUT_MS = 20_000;
const DEFAULT_DRAIN_DEADLINE_MS = 40_000;
const DEFAULT_PRUNE_INTERVAL_MS = 60 * 60 * 1_000;

function positiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.floor(value);
}

function waitForNextPoll(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Drain the durable queue from a long-running process.
 *
 * This is the portable alternative to `/api/cron/jobs`: the same lease-safe
 * runner works in a container, VM, Kubernetes deployment, or local terminal.
 */
export async function runJobWorker(
  options: JobWorkerOptions,
  dependencies: JobWorkerDependencies = {
    run: runDueJobs,
    prune: pruneFinishedJobs,
    now: Date.now,
  },
): Promise<void> {
  const pollIntervalMs = positiveInteger(
    options.pollIntervalMs,
    DEFAULT_POLL_INTERVAL_MS,
  );
  const batchSize = positiveInteger(options.batchSize, DEFAULT_BATCH_SIZE);
  const handlerTimeoutMs = positiveInteger(
    options.handlerTimeoutMs,
    DEFAULT_HANDLER_TIMEOUT_MS,
  );
  const drainDeadlineMs = positiveInteger(
    options.drainDeadlineMs,
    DEFAULT_DRAIN_DEADLINE_MS,
  );
  const pruneIntervalMs = positiveInteger(
    options.pruneIntervalMs,
    DEFAULT_PRUNE_INTERVAL_MS,
  );
  let lastPrunedAt = 0;

  while (!options.signal.aborted) {
    try {
      const result = await dependencies.run(batchSize, {
        handlerTimeoutMs,
        drainDeadlineMs,
        signal: options.signal,
      });
      const now = dependencies.now();

      if (now - lastPrunedAt >= pruneIntervalMs) {
        await dependencies.prune();
        lastPrunedAt = now;
      }

      if (result.claimed > 0) {
        logger.info(
          {
            event: "jobs.worker_cycle",
            claimed: result.claimed,
            succeeded: result.succeeded,
            retrying: result.retrying,
            failed: result.failed,
            lease_lost: result.leaseLost,
          },
          "job worker drained queue",
        );
      }

      if (options.once) return;

      // A full batch probably means more work is ready, so continue without
      // adding latency. An incomplete batch reached the current end of queue.
      if (result.claimed < batchSize) {
        await waitForNextPoll(pollIntervalMs, options.signal);
      }
    } catch (error) {
      logger.error(
        { err: error, event: "jobs.worker_cycle_failed" },
        "job worker cycle failed",
      );
      if (options.once) throw error;
      await waitForNextPoll(pollIntervalMs, options.signal);
    }
  }
}
