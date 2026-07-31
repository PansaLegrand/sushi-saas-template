import { AdminPageHeader } from "@admin/components/admin-page-header";
import { AdminStatusBadge } from "@admin/components/admin-status-badge";
import {
  AdminTable,
  AdminTableBody,
  AdminTableCell,
  AdminTableEmpty,
  AdminTableHead,
  AdminTableHeader,
  AdminTableRow,
} from "@admin/components/admin-table";
import { getAdminContext } from "@admin/lib/authz";
import { countAdminAuditLogs, listAdminAuditLogs } from "@admin/lib/audit";
import { formatAdminDate } from "@admin/lib/format";
import { Pager } from "@admin/components/pager";

const PAGE_SIZE = 100;

/**
 * The audit trail.
 *
 * Paged rather than capped, and of the console's lists this is the one where
 * that is not a convenience. It is the answer to "who changed this, and when" —
 * asked long after the change, about an entry that is by then nowhere near the
 * newest hundred. A compliance surface that can only show the most recent page
 * answers every interesting question with silence.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  // Layout guards admin, this is a safety net.
  const admin = await getAdminContext();
  if (!admin) return null;

  const { page: rawPage } = await searchParams;
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);

  const [rows, total] = await Promise.all([
    listAdminAuditLogs(page, PAGE_SIZE),
    countAdminAuditLogs(),
  ]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Audit log"
        description="Trace administrative changes, their target, and the operator responsible."
        actions={
          <p className="text-sm text-muted-foreground">Total: {total ?? 0}</p>
        }
      />

      <AdminTable caption="Administrative audit log" className="min-w-[72rem]">
        <AdminTableHeader>
          <tr>
            <AdminTableHead>When</AdminTableHead>
            <AdminTableHead>Actor</AdminTableHead>
            <AdminTableHead>Action and target</AdminTableHead>
            <AdminTableHead>Status</AdminTableHead>
            <AdminTableHead>Context</AdminTableHead>
          </tr>
        </AdminTableHeader>
        <AdminTableBody>
          {(rows ?? []).length === 0 && (
            <AdminTableEmpty
              colSpan={5}
              title="No audit entries"
              description="Administrative changes will be recorded here."
            />
          )}
          {(rows ?? []).map((row) => (
            <AdminTableRow key={row.uuid}>
              <AdminTableCell className="whitespace-nowrap text-muted-foreground">
                {formatAdminDate(row.created_at)}
              </AdminTableCell>
              <AdminTableCell>
                <div className="font-medium">{row.actor_email || "—"}</div>
                <div className="text-sm text-muted-foreground">
                  {row.actor_role}
                </div>
                <div className="mt-1 font-mono text-sm text-muted-foreground">
                  {row.ip_address || "No IP"}
                </div>
              </AdminTableCell>
              <AdminTableCell>
                <div className="font-medium">{row.action}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {row.target_type || "—"}
                </div>
                <div className="font-mono text-sm">
                  {row.target_uuid || "—"}
                </div>
              </AdminTableCell>
              <AdminTableCell>
                <AdminStatusBadge
                  tone={row.status === "succeeded" ? "success" : "danger"}
                >
                  {row.status}
                </AdminStatusBadge>
              </AdminTableCell>
              <AdminTableCell className="max-w-[36rem]">
                {row.note ? (
                  <p className="mb-2 whitespace-pre-wrap">{row.note}</p>
                ) : null}
                <code className="block whitespace-pre-wrap break-all text-sm leading-5 text-muted-foreground">
                  {row.error_message || row.metadata_json || "—"}
                </code>
              </AdminTableCell>
            </AdminTableRow>
          ))}
        </AdminTableBody>
      </AdminTable>

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total ?? 0}
        unit="entries"
        href={(target) => `/audit?page=${target}`}
      />
    </div>
  );
}
