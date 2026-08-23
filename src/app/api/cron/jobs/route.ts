import { requireCronAuth } from "@/lib/cron";
import { respData } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { countJobsByStatus } from "@/models/job";
import { runDueJobs } from "@/services/jobs";
import { runOperationalMaintenance } from "@/services/maintenance";
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
    // Runs after the drain, so an alert it enqueues is not picked up until the
    // next tick — which is what keeps a sweep that alerts on every run from
    // being indistinguishable from one that found something new.
    const maintenance = await runOperationalMaintenance();
    const pending = await countJobsByStatus();

    logger.info(
      {
        event: "cron.jobs",
        ...result,
        finished_jobs_pruned: maintenance.finishedJobsPruned,
        stale_uploads_failed: maintenance.staleUploadsFailed,
        stripe_stuck_events: maintenance.stripe.stuck,
        marketing_provider_events_pruned:
          maintenance.marketingProviderEventsPruned,
        duration_ms: Date.now() - startedAt,
      },
      "cron jobs drained",
    );

    return respData({
      ...result,
      storage: { staleUploadsFailed: maintenance.staleUploadsFailed },
      stripe: maintenance.stripe,
      retention: { finishedJobsPruned: maintenance.finishedJobsPruned },
      marketing: {
        providerEventsPruned: maintenance.marketingProviderEventsPruned,
      },
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
