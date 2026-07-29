import { AdminPageHeader } from "@admin/components/admin-page-header";
import { getAdminContext } from "@admin/lib/authz";
import { countAdminAuditLogs, listAdminAuditLogs } from "@admin/lib/audit";
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
    <div className="space-y-4">
      <AdminPageHeader
        title="Audit log"
        description="Trace administrative changes, their target, and the operator responsible."
        actions={
          <p className="text-sm text-muted-foreground">Total: {total ?? 0}</p>
        }
      />

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 pr-4">When</th>
              <th className="py-2 pr-4">Actor</th>
              <th className="py-2 pr-4">Action</th>
              <th className="py-2 pr-4">Target</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Reason</th>
              <th className="py-2 pr-4">Details</th>
              <th className="py-2 pr-4">IP</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <tr key={row.uuid} className="border-t align-top">
                <td className="py-2 pr-4 font-mono text-xs">
                  {row.created_at ? row.created_at.toISOString() : "—"}
                </td>
                <td className="py-2 pr-4">
                  <div className="text-xs">{row.actor_email || "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.actor_role}
                  </div>
                </td>
                <td className="py-2 pr-4">{row.action}</td>
                <td className="py-2 pr-4">
                  <div className="text-xs text-muted-foreground">
                    {row.target_type || "—"}
                  </div>
                  <div className="font-mono text-xs">
                    {row.target_uuid || "—"}
                  </div>
                </td>
                <td className="py-2 pr-4 capitalize">{row.status}</td>
                <td className="py-2 pr-4 max-w-[20rem] whitespace-pre-wrap">
                  {row.note || "—"}
                </td>
                <td className="py-2 pr-4 max-w-[24rem]">
                  <code className="block whitespace-pre-wrap break-all text-[10px]">
                    {row.error_message || row.metadata_json || "—"}
                  </code>
                </td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {row.ip_address || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
