import { AdminPageHeader } from "@admin/components/admin-page-header";
import { getAdminContext } from "@admin/lib/authz";
import { countAdminAffiliates, listAdminAffiliates } from "@admin/lib/data";
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

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 pr-4">User</th>
              <th className="py-2 pr-4">Invited By</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Order</th>
              <th className="py-2 pr-4">Paid</th>
              <th className="py-2 pr-4">Reward</th>
              <th className="py-2 pr-4">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-muted-foreground" colSpan={7}>
                  No affiliate activity.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.id}`} className="border-t">
                <td className="py-2 pr-4">
                  <div className="font-mono text-xs">
                    {(r as any).user?.uuid ?? r.user_uuid}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {(r as any).user?.email ?? ""}
                  </div>
                </td>
                <td className="py-2 pr-4">
                  <div className="font-mono text-xs">
                    {(r as any).invited_by_user?.uuid ?? r.invited_by}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {(r as any).invited_by_user?.email ?? ""}
                  </div>
                </td>
                <td className="py-2 pr-4">{r.status}</td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {r.paid_order_no || "—"}
                </td>
                <td className="py-2 pr-4">
                  {r.paid_amount > 0
                    ? `$${(r.paid_amount / 100).toFixed(2)}`
                    : "—"}
                </td>
                <td className="py-2 pr-4">
                  {r.reward_amount > 0
                    ? `$${(r.reward_amount / 100).toFixed(2)}`
                    : "—"}
                </td>
                <td className="py-2 pr-4">
                  {r.created_at ? r.created_at.toISOString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
