import { getAppEnv } from "@/lib/env";

export type RetentionPolicy = {
  finishedJobsDays: number;
  marketingProviderEventsDays: number;
  authEventsDays: number;
  adminAuditLogsDays: number;
};

/**
 * Co-versioned defaults, overridable per deployment after legal review.
 * Financial ledgers, orders, subscriptions, and user content are deliberately
 * absent: this generic operational policy must never delete product records.
 */
export function getRetentionPolicy(): RetentionPolicy {
  const env = getAppEnv();
  return {
    finishedJobsDays: env.RETENTION_FINISHED_JOBS_DAYS,
    marketingProviderEventsDays: env.RETENTION_MARKETING_EVENTS_DAYS,
    authEventsDays: env.RETENTION_AUTH_EVENTS_DAYS,
    adminAuditLogsDays: env.RETENTION_ADMIN_AUDIT_DAYS,
  };
}
