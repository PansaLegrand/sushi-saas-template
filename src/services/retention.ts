import { getRetentionPolicy, type RetentionPolicy } from "@/config/retention";
import { deleteFinishedJobsBefore } from "@/models/job";
import { deleteMarketingProviderEventsBefore } from "@/models/marketing";
import {
  countRetentionCandidates,
  deleteAdminAuditLogsBefore,
  deleteAuthEventsBefore,
  type RetentionCutoffs,
} from "@/models/retention";

const DAY_MS = 24 * 60 * 60 * 1_000;

export function retentionCutoffs(
  policy: RetentionPolicy,
  now: Date = new Date(),
): RetentionCutoffs {
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return {
    finishedJobs: before(policy.finishedJobsDays),
    marketingProviderEvents: before(policy.marketingProviderEventsDays),
    authEvents: before(policy.authEventsDays),
    adminAuditLogs: before(policy.adminAuditLogsDays),
  };
}

export async function getRetentionReport(now: Date = new Date()) {
  const policy = getRetentionPolicy();
  const cutoffs = retentionCutoffs(policy, now);
  return {
    generatedAt: now,
    policy,
    cutoffs,
    candidates: await countRetentionCandidates(cutoffs),
  };
}

/**
 * Apply only operational-log retention. Product, financial, and user-authored
 * tables are not reachable from this function.
 */
export async function applyRetentionPolicy(now: Date = new Date()) {
  const policy = getRetentionPolicy();
  const cutoffs = retentionCutoffs(policy, now);
  const deleted = {
    finishedJobs: await deleteFinishedJobsBefore(cutoffs.finishedJobs),
    marketingProviderEvents: await deleteMarketingProviderEventsBefore(
      cutoffs.marketingProviderEvents,
    ),
    authEvents: await deleteAuthEventsBefore(cutoffs.authEvents),
    adminAuditLogs: await deleteAdminAuditLogsBefore(cutoffs.adminAuditLogs),
  };
  return { appliedAt: now, policy, cutoffs, deleted };
}
