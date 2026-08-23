import { and, inArray, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  adminAuditLogs,
  authEvents,
  jobs,
  marketingProviderEvents,
} from "@/db/schema";

export type RetentionCutoffs = {
  finishedJobs: Date;
  marketingProviderEvents: Date;
  authEvents: Date;
  adminAuditLogs: Date;
};

export type RetentionCandidate = {
  count: number;
  oldestAt: Date | null;
};

export type RetentionCandidates = Record<
  keyof RetentionCutoffs,
  RetentionCandidate
>;

function normalizeCandidate(row: {
  count: number | undefined;
  oldestAt: Date | string | null | undefined;
}): RetentionCandidate {
  return {
    count: row.count ?? 0,
    oldestAt: row.oldestAt
      ? row.oldestAt instanceof Date
        ? row.oldestAt
        : new Date(row.oldestAt)
      : null,
  };
}

export async function countRetentionCandidates(
  cutoffs: RetentionCutoffs,
): Promise<RetentionCandidates> {
  const [finishedJobRows, marketingRows, authRows, adminRows] =
    await Promise.all([
      db()
        .select({
          count: sql<number>`count(*)::int`,
          oldestAt: sql<Date | null>`min(${jobs.completed_at})`,
        })
        .from(jobs)
        .where(
          and(
            inArray(jobs.status, ["succeeded", "failed", "canceled"]),
            lt(jobs.completed_at, cutoffs.finishedJobs),
          ),
        ),
      db()
        .select({
          count: sql<number>`count(*)::int`,
          oldestAt: sql<Date | null>`min(${marketingProviderEvents.received_at})`,
        })
        .from(marketingProviderEvents)
        .where(
          lt(
            marketingProviderEvents.received_at,
            cutoffs.marketingProviderEvents,
          ),
        ),
      db()
        .select({
          count: sql<number>`count(*)::int`,
          oldestAt: sql<Date | null>`min(${authEvents.created_at})`,
        })
        .from(authEvents)
        .where(lt(authEvents.created_at, cutoffs.authEvents)),
      db()
        .select({
          count: sql<number>`count(*)::int`,
          oldestAt: sql<Date | null>`min(${adminAuditLogs.created_at})`,
        })
        .from(adminAuditLogs)
        .where(lt(adminAuditLogs.created_at, cutoffs.adminAuditLogs)),
    ]);

  return {
    finishedJobs: normalizeCandidate(finishedJobRows[0] ?? {}),
    marketingProviderEvents: normalizeCandidate(marketingRows[0] ?? {}),
    authEvents: normalizeCandidate(authRows[0] ?? {}),
    adminAuditLogs: normalizeCandidate(adminRows[0] ?? {}),
  };
}

function countFromExecute(result: unknown): number {
  const rows = result as
    | Array<{ count: number | string }>
    | {
        rows?: Array<{ count: number | string }>;
      };
  const row = Array.isArray(rows) ? rows[0] : rows.rows?.[0];
  return Number(row?.count ?? 0);
}

export async function deleteAuthEventsBefore(cutoff: Date): Promise<number> {
  const cutoffIso = cutoff.toISOString();
  return countFromExecute(
    await db().execute(sql`
      with deleted as (
        delete from ${authEvents}
        where ${authEvents.created_at} < ${cutoffIso}::timestamptz
        returning 1
      )
      select count(*)::int as count from deleted
    `),
  );
}

export async function deleteAdminAuditLogsBefore(
  cutoff: Date,
): Promise<number> {
  const cutoffIso = cutoff.toISOString();
  return countFromExecute(
    await db().execute(sql`
      with deleted as (
        delete from ${adminAuditLogs}
        where ${adminAuditLogs.created_at} < ${cutoffIso}::timestamptz
        returning 1
      )
      select count(*)::int as count from deleted
    `),
  );
}
