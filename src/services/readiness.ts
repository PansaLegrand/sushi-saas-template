import { validateAppEnv } from "@/lib/env";
import { checkRateLimitStoreReady } from "@/lib/rate-limit";
import { checkDatabaseReadiness } from "@/models/readiness";
import { getJobQueueReadiness } from "@/models/job";

const STALE_JOB_MS = 5 * 60 * 1000;
const DEGRADED_QUEUE_AGE_MS = 10 * 60 * 1000;

export type ReadinessReport = {
  ready: boolean;
  checks: {
    env: "ok" | "error";
    database: "ok" | "error";
    redis: "ok" | "error";
    queue: "ok" | "degraded" | "unknown";
  };
  details: {
    migrationsApplied?: number;
    distributedRateLimit?: boolean;
    queue?: Awaited<ReturnType<typeof getJobQueueReadiness>>;
  };
};

/**
 * Check dependencies required to safely accept traffic.
 *
 * A stale/failed background job degrades the report but does not remove the web
 * app from service; losing the database or distributed limiter does.
 */
export async function getReadinessReport(): Promise<ReadinessReport> {
  let envStatus: "ok" | "error" = "ok";
  try {
    validateAppEnv();
  } catch {
    envStatus = "error";
  }

  const [database, redis] = await Promise.allSettled([
    checkDatabaseReadiness(),
    checkRateLimitStoreReady(),
  ]);

  let queue: Awaited<ReturnType<typeof getJobQueueReadiness>> | undefined;
  if (database.status === "fulfilled") {
    try {
      const now = new Date();
      queue = await getJobQueueReadiness(
        new Date(now.getTime() - STALE_JOB_MS),
        now,
      );
    } catch {
      // The database probe succeeded but this operational query did not. It is
      // observable as unknown without leaking a driver message.
    }
  }

  const queueStatus =
    queue === undefined
      ? "unknown"
      : queue.staleRunning > 0 ||
          queue.failed > 0 ||
          (queue.oldestDueAgeMs ?? 0) > DEGRADED_QUEUE_AGE_MS
        ? "degraded"
        : "ok";

  return {
    ready:
      envStatus === "ok" &&
      database.status === "fulfilled" &&
      redis.status === "fulfilled",
    checks: {
      env: envStatus,
      database: database.status === "fulfilled" ? "ok" : "error",
      redis: redis.status === "fulfilled" ? "ok" : "error",
      queue: queueStatus,
    },
    details: {
      ...(database.status === "fulfilled"
        ? { migrationsApplied: database.value.migrationsApplied }
        : {}),
      ...(redis.status === "fulfilled"
        ? { distributedRateLimit: redis.value.distributed }
        : {}),
      ...(queue ? { queue } : {}),
    },
  };
}
