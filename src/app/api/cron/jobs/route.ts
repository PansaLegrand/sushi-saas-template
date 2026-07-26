import { requireCronAuth } from "@/lib/cron";
import { respData } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { countJobsByStatus } from "@/models/job";
import { pruneFinishedJobs, runDueJobs } from "@/services/jobs";
import { cleanupStaleUploads } from "@/services/storage/cleanup";
import { logger } from "@/lib/logger/server";

// Always run on demand; never cached.
export const dynamic = "force-dynamic";
// Vercel caps this per plan; keep headroom for slow third-party calls.
export const maxDuration = 60;

/**
 * Drains the job queue. Wired to Vercel Cron in vercel.json.
 *
 * Safe to invoke concurrently: claiming uses FOR UPDATE SKIP LOCKED, so
 * overlapping runs take disjoint jobs.
 */
export async function GET(req: Request) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const startedAt = Date.now();

  try {
    const result = await runDueJobs(25);
    await pruneFinishedJobs();
    const staleUploadsFailed = await cleanupStaleUploads();
    const pending = await countJobsByStatus();

    logger.info(
      {
        event: "cron.jobs",
        ...result,
        stale_uploads_failed: staleUploadsFailed,
        duration_ms: Date.now() - startedAt,
      },
      "cron jobs drained"
    );

    return respData({
      ...result,
      storage: { staleUploadsFailed },
      queue: pending,
      durationMs: Date.now() - startedAt,
    });
  } catch (e) {
    return respError(e, {
      logFields: { event: "cron.jobs_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
