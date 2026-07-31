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
import { countAdminAffiliates, listAdminAffiliates } from "@admin/lib/data";
import { formatAdminDate, formatAdminMoney } from "@admin/lib/format";
import { Pager } from "@admin/components/pager";

const PAGE_SIZE = 100;

export default async function AdminAffiliatesPage({
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
    listAdminAffiliates(page, PAGE_SIZE),
    countAdminAffiliates(),
  ]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Affiliates"
        description="Review referral attribution, qualifying orders, and rewards."
        actions={
          <p className="text-sm text-muted-foreground">Total: {total}</p>
        }
      />

      <AdminTable caption="Affiliate referrals" className="min-w-[68rem]">
        <AdminTableHeader>
          <tr>
            <AdminTableHead>User</AdminTableHead>
            <AdminTableHead>Invited by</AdminTableHead>
            <AdminTableHead>Status</AdminTableHead>
            <AdminTableHead>Order</AdminTableHead>
            <AdminTableHead>Paid</AdminTableHead>
            <AdminTableHead>Reward</AdminTableHead>
            <AdminTableHead>Created</AdminTableHead>
          </tr>
        </AdminTableHeader>
        <AdminTableBody>
          {rows.length === 0 && (
            <AdminTableEmpty
              colSpan={7}
              title="No affiliate activity"
              description="Referral attribution will appear here after the first invitation."
            />
          )}
          {rows.map((r) => (
            <AdminTableRow key={`${r.id}`}>
              <AdminTableCell>
                <div className="font-medium">
                  {(r as any).user?.email || "Unknown user"}
                </div>
                <div className="font-mono text-sm text-muted-foreground">
                  {(r as any).user?.uuid ?? r.user_uuid}
                </div>
              </AdminTableCell>
              <AdminTableCell>
                <div className="font-medium">
                  {(r as any).invited_by_user?.email || "Unknown user"}
                </div>
                <div className="font-mono text-sm text-muted-foreground">
                  {(r as any).invited_by_user?.uuid ?? r.invited_by}
                </div>
              </AdminTableCell>
              <AdminTableCell>
                <AdminStatusBadge
                  tone={r.status === "completed" ? "success" : "neutral"}
                >
                  {r.status}
                </AdminStatusBadge>
              </AdminTableCell>
              <AdminTableCell className="font-mono">
                {r.paid_order_no || "—"}
              </AdminTableCell>
              <AdminTableCell className="whitespace-nowrap tabular-nums">
                {r.paid_amount > 0 ? formatAdminMoney(r.paid_amount) : "—"}
              </AdminTableCell>
              <AdminTableCell className="whitespace-nowrap tabular-nums">
                {r.reward_amount > 0 ? formatAdminMoney(r.reward_amount) : "—"}
              </AdminTableCell>
              <AdminTableCell className="whitespace-nowrap text-muted-foreground">
                {formatAdminDate(r.created_at)}
              </AdminTableCell>
            </AdminTableRow>
          ))}
        </AdminTableBody>
      </AdminTable>

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        unit="referrals"
        href={(target) => `/affiliates?page=${target}`}
      />
    </div>
  );
}
