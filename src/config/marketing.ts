/**
 * Deliberate first-release safety limit. Raising it should be accompanied by
 * throughput, provider quota, and job-runner capacity review.
 */
export const MARKETING_CAMPAIGN_RECIPIENT_LIMIT = 5_000;

/** Provider retry windows are short; delivery audit remains after receipts go. */
export const MARKETING_PROVIDER_EVENT_RETENTION_DAYS = 30;
