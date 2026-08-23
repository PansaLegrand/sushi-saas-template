import { pruneFinishedJobs } from "@/services/jobs";
import { pruneMarketingProviderEvents } from "@/services/marketing/operations";
import { cleanupStaleUploads } from "@/services/storage/cleanup";
import { sweepStripeWebhookEvents } from "@/services/stripe/sweep";

/** Maintenance shared by HTTP cron and the portable worker. */
export async function runOperationalMaintenance(now: Date = new Date()) {
  const finishedJobsPruned = await pruneFinishedJobs(now);
  const marketingProviderEventsPruned = await pruneMarketingProviderEvents(now);
  const staleUploadsFailed = await cleanupStaleUploads({ now });
  const stripe = await sweepStripeWebhookEvents(now);

  return {
    finishedJobsPruned,
    marketingProviderEventsPruned,
    staleUploadsFailed,
    stripe,
  };
}
