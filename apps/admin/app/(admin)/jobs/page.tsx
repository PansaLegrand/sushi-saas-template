import { ManageJob } from "@admin/components/manage-job";
import { AdminPanel } from "@admin/components/admin-panel";
import { AdminPageHeader } from "@admin/components/admin-page-header";
import {
  AdminStatusBadge,
  type AdminStatusTone,
} from "@admin/components/admin-status-badge";
import {
  AdminTable,
  AdminTableBody,
  AdminTableCell,
  AdminTableEmpty,
  AdminTableHead,
  AdminTableHeader,
  AdminTableRow,
} from "@admin/components/admin-table";
import {
  AdminFilterLink,
  AdminFilterNav,
  AdminSearchToolbar,
} from "@admin/components/admin-toolbar";
import { getAdminContext } from "@admin/lib/authz";
import {
  countAdminJobs,
  countAdminJobsByStatus,
  listAdminJobs,
} from "@admin/lib/data";
import { formatAdminDate } from "@admin/lib/format";
import { Pager } from "@admin/components/pager";
import { getJobQueueReadiness } from "@/models/job";
import { isOperatorCancelableJobType } from "@/services/jobs/operator";

const PAGE_SIZE = 50;
const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "canceled", label: "Canceled" },
] as const;

function jobStatusTone(status: string): AdminStatusTone {
  if (status === "failed") return "danger";
  if (status === "pending") return "warning";
  if (status === "running") return "info";
  if (status === "succeeded") return "success";
  return "neutral";
}

function ageLabel(milliseconds: number | null): string {
  if (milliseconds === null) return "none due";
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return "under 1 minute";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const admin = await getAdminContext();
  if (!admin) return null;
  const canWrite = admin.role === "admin_rw";

  const { status: rawStatus, q, page: rawPage } = await searchParams;
  const status = STATUS_FILTERS.some(
    (filter) => filter.value && filter.value === rawStatus,
  )
    ? rawStatus
    : undefined;
  const query = q?.trim() || undefined;
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);
  const now = new Date();

  const [rows, total, byStatus, readiness] = await Promise.all([
    listAdminJobs({ status, query, page, limit: PAGE_SIZE }),
    countAdminJobs({ status, query }),
    countAdminJobsByStatus(),
    getJobQueueReadiness(new Date(now.getTime() - 5 * 60_000), now),
  ]);

  const allTotal = Object.values(byStatus).reduce(
    (sum, count) => sum + count,
    0,
  );
  const filterHref = (value: string) =>
    value ? `/jobs?status=${value}` : "/jobs";
  const pageHref = (target: number) => {
    const parts = [
      status ? `status=${status}` : "",
      query ? `q=${encodeURIComponent(query)}` : "",
      `page=${target}`,
    ].filter(Boolean);
    return `/jobs?${parts.join("&")}`;
  };
  const unhealthy =
    readiness.failed > 0 ||
    readiness.staleRunning > 0 ||
    (readiness.oldestDueAgeMs ?? 0) > 10 * 60_000;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Background jobs"
        description="Inspect queue health, retry failed work, and cancel standalone notifications that have not been claimed."
        actions={
          <p className="text-sm text-muted-foreground">
            {query || status ? `Matching: ${total}` : `Total: ${allTotal}`}
          </p>
        }
      />

      <AdminPanel
        title={unhealthy ? "Queue needs attention" : "Queue is healthy"}
        description="Payload JSON and deduplication keys are intentionally excluded from this console."
        className={unhealthy ? "border-destructive/30" : undefined}
      >
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-sm text-muted-foreground">Due now</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {readiness.duePending}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Oldest due</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {ageLabel(readiness.oldestDueAgeMs)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Stale running</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {readiness.staleRunning}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Failed</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {readiness.failed}
            </dd>
          </div>
        </dl>
      </AdminPanel>

      <AdminSearchToolbar
        defaultValue={query}
        placeholder="Job UUID, type, user, or organization"
        ariaLabel="Search background jobs"
        clearHref={filterHref(status ?? "")}
        hiddenInputs={status ? [{ name: "status", value: status }] : []}
        className="items-stretch sm:flex-col sm:items-stretch xl:flex-row xl:items-center"
      >
        <AdminFilterNav label="Filter jobs by status" className="shrink-0">
          {STATUS_FILTERS.map((filter) => (
            <AdminFilterLink
              key={filter.value || "all"}
              href={filterHref(filter.value)}
              active={(status ?? "") === filter.value}
              count={filter.value ? (byStatus[filter.value] ?? 0) : allTotal}
            >
              {filter.label}
            </AdminFilterLink>
          ))}
        </AdminFilterNav>
      </AdminSearchToolbar>

      <AdminTable caption="Durable background jobs" className="min-w-[86rem]">
        <AdminTableHeader>
          <tr>
            <AdminTableHead>Job</AdminTableHead>
            <AdminTableHead>Status</AdminTableHead>
            <AdminTableHead>Attempts</AdminTableHead>
            <AdminTableHead>Schedule</AdminTableHead>
            <AdminTableHead>Subject</AdminTableHead>
            <AdminTableHead>Last error</AdminTableHead>
            <AdminTableHead>
              <span className="sr-only">Actions</span>
            </AdminTableHead>
          </tr>
        </AdminTableHeader>
        <AdminTableBody>
          {rows.length === 0 ? (
            <AdminTableEmpty
              colSpan={7}
              title={query ? "No matching jobs" : "No jobs in this status"}
              description={query ? `Nothing matched “${query}”.` : undefined}
            />
          ) : null}
          {rows.map((job) => (
            <AdminTableRow key={job.id}>
              <AdminTableCell>
                <div className="font-medium">{job.type}</div>
                <div className="mt-1 break-all font-mono text-sm text-muted-foreground select-all">
                  {job.uuid}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Created {formatAdminDate(job.created_at)}
                </div>
              </AdminTableCell>
              <AdminTableCell>
                <AdminStatusBadge tone={jobStatusTone(job.status)}>
                  {job.status}
                </AdminStatusBadge>
              </AdminTableCell>
              <AdminTableCell className="tabular-nums">
                {job.attempts} / {job.max_attempts}
              </AdminTableCell>
              <AdminTableCell className="whitespace-nowrap text-sm">
                <dl className="space-y-1">
                  <div>
                    <dt className="inline text-muted-foreground">Run: </dt>
                    <dd className="inline">{formatAdminDate(job.run_at)}</dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">Locked: </dt>
                    <dd className="inline">{formatAdminDate(job.locked_at)}</dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">Done: </dt>
                    <dd className="inline">
                      {formatAdminDate(job.completed_at)}
                    </dd>
                  </div>
                </dl>
              </AdminTableCell>
              <AdminTableCell className="max-w-xs font-mono text-sm">
                <div className="break-all">
                  user: {job.subject_user_uuid ?? "—"}
                </div>
                <div className="mt-1 break-all">
                  org: {job.subject_org_uuid ?? "—"}
                </div>
              </AdminTableCell>
              <AdminTableCell className="max-w-sm whitespace-pre-wrap break-words text-sm">
                {job.last_error ?? "—"}
              </AdminTableCell>
              <AdminTableCell>
                {!canWrite ? (
                  <span className="text-sm text-muted-foreground">
                    Read-only
                  </span>
                ) : job.status === "failed" ? (
                  <ManageJob uuid={job.uuid} action="retry" />
                ) : job.status === "pending" &&
                  isOperatorCancelableJobType(job.type) ? (
                  <ManageJob uuid={job.uuid} action="cancel" />
                ) : job.status === "pending" ? (
                  <span className="text-sm text-muted-foreground">
                    Managed workflow
                  </span>
                ) : (
                  "—"
                )}
              </AdminTableCell>
            </AdminTableRow>
          ))}
        </AdminTableBody>
      </AdminTable>

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        unit="jobs"
        href={pageHref}
      />

      <AdminPanel contentClassName="text-sm leading-6 text-muted-foreground">
        <p>
          Run <code>pnpm jobs:work</code> as a dedicated process on a VM or
          container. Use <code>pnpm jobs:run</code> for a one-shot scheduler.
          Running multiple workers is safe because claims use row locks and a
          lease token.
        </p>
      </AdminPanel>
    </div>
  );
}
