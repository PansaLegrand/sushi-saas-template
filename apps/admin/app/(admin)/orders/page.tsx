import Link from "next/link";

import { AdminPanel } from "@admin/components/admin-panel";
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
import {
  AdminFilterLink,
  AdminFilterNav,
  AdminSearchToolbar,
} from "@admin/components/admin-toolbar";
import { getAdminContext } from "@admin/lib/authz";
import {
  countAdminOrders,
  countAdminOrdersByStatus,
  listAdminOrders,
} from "@admin/lib/data";
import { formatAdminDate } from "@admin/lib/format";
import { Pager } from "@admin/components/pager";
import { findCreditsByOrderNos } from "@/models/credit";

/**
 * Orders.
 *
 * The overview's latest-20 table was a bare `select()`: no tenant, no status
 * filter, no way to find one, and no answer to the question the table exists to
 * settle — did the credits this order promised actually reach the ledger?
 *
 * That last column is the point. A paid order with no ledger row is the defect
 * roadmap item 4 was written about, and reconciliation already finds it in bulk;
 * this is the same check per row, where an operator is already looking when a
 * customer says the credits never arrived.
 */

const PAGE_SIZE = 50;

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "created", label: "Unpaid" },
  { value: "deleted", label: "Deleted" },
] as const;

/**
 * What an order number's shape says about where it came from.
 *
 * Three formats coexist and nothing explained them. `renewal:<sub>:<period>` is
 * derived from the billing period so a Stripe redelivery collides instead of
 * billing twice; the rest are per-checkout ids, newer ones UUIDv7.
 */
function describeOrderNo(orderNo: string): { kind: string; hint: string } {
  if (orderNo.startsWith("renewal:")) {
    return {
      kind: "renewal",
      hint: "Derived from subscription + billing period, so a redelivery cannot bill twice",
    };
  }
  if (/^\d+$/.test(orderNo)) {
    return {
      kind: "legacy",
      hint: "Numeric id from before UUIDv7 order numbers",
    };
  }
  return { kind: "checkout", hint: "One-off checkout" };
}

function money(amount: number, currency: string | null) {
  return `${(amount / 100).toFixed(2)} ${(currency ?? "usd").toUpperCase()}`;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  // Layout already guards; this is a type-safety fallback.
  const admin = await getAdminContext();
  if (!admin) return null;

  const { status: rawStatus, q, page: rawPage } = await searchParams;

  // Only statuses this app writes. An arbitrary value would otherwise reach the
  // query and return a confusing empty table.
  const status = STATUS_FILTERS.some((f) => f.value && f.value === rawStatus)
    ? rawStatus
    : undefined;
  const query = q?.trim() || undefined;
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);

  const [rows, total, byStatus] = await Promise.all([
    listAdminOrders({ status, query, page, limit: PAGE_SIZE }),
    countAdminOrders({ status, query }),
    countAdminOrdersByStatus(),
  ]);

  // Fetched for the page's orders only, so this stays one small query however
  // large the table gets.
  const ledger = await findCreditsByOrderNos(rows.map((r) => r.order_no));
  const grantsByOrder = new Map<string, { credits: number; count: number }>();
  for (const row of ledger) {
    if (!row.order_no) continue;
    const seen = grantsByOrder.get(row.order_no) ?? { credits: 0, count: 0 };
    grantsByOrder.set(row.order_no, {
      credits: seen.credits + row.credits,
      count: seen.count + 1,
    });
  }

  const allTotal = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  const filterHref = (value: string) =>
    value ? `/orders?status=${value}` : "/orders";
  const pageHref = (target: number) => {
    const parts = [
      status ? `status=${status}` : "",
      query ? `q=${encodeURIComponent(query)}` : "",
      `page=${target}`,
    ].filter(Boolean);
    return `/orders?${parts.join("&")}`;
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Orders"
        description={
          <p>
            Credits pool at the{" "}
            <Link href="/organizations" className="underline">
              organization
            </Link>
            , which is the tenant an order&apos;s grant lands in.
          </p>
        }
        actions={
          <p className="text-sm text-muted-foreground">
            {query || status ? `Matching: ${total}` : `Total: ${total}`}
          </p>
        }
      />

      {/* GET keeps search and status together in a shareable support URL. */}
      <AdminSearchToolbar
        defaultValue={query}
        placeholder="Order no, sub_…, org, user UUID, or email"
        ariaLabel="Search orders"
        clearHref={filterHref(status ?? "")}
        hiddenInputs={status ? [{ name: "status", value: status }] : []}
        className="items-stretch sm:flex-col sm:items-stretch xl:flex-row xl:items-center"
      >
        <AdminFilterNav label="Filter orders by status" className="shrink-0">
          {STATUS_FILTERS.map((filter) => {
            const count = filter.value
              ? (byStatus[filter.value] ?? 0)
              : allTotal;

            return (
              <AdminFilterLink
                key={filter.value || "all"}
                href={filterHref(filter.value)}
                active={(status ?? "") === filter.value}
                count={count}
              >
                {filter.label}
              </AdminFilterLink>
            );
          })}
        </AdminFilterNav>
      </AdminSearchToolbar>

      <AdminTable caption="Orders and credit grants" className="min-w-[76rem]">
        <AdminTableHeader>
          <tr>
            <AdminTableHead>Order</AdminTableHead>
            <AdminTableHead>Customer and workspace</AdminTableHead>
            <AdminTableHead>Status</AdminTableHead>
            <AdminTableHead>Payment</AdminTableHead>
            <AdminTableHead>Product and credits</AdminTableHead>
            <AdminTableHead>Fulfillment</AdminTableHead>
          </tr>
        </AdminTableHeader>
        <AdminTableBody>
          {rows.length === 0 && (
            <AdminTableEmpty
              colSpan={6}
              title={query ? "No matching orders" : "No orders yet"}
              description={
                query
                  ? `Nothing matched “${query}”. Try another identifier.`
                  : undefined
              }
            />
          )}
          {rows.map((order) => {
            const shape = describeOrderNo(order.order_no);
            const grant = grantsByOrder.get(order.order_no);
            const paid = order.status === "paid";
            const owed = order.credits > 0;
            const missing = paid && owed && !grant;

            return (
              <AdminTableRow key={order.id}>
                <AdminTableCell>
                  <div className="font-mono break-all select-all">
                    {order.order_no}
                  </div>
                  <div
                    className="mt-1 text-sm text-muted-foreground"
                    title={shape.hint}
                  >
                    {shape.kind}
                    {order.sub_id ? ` · ${order.sub_id}` : ""}
                  </div>
                </AdminTableCell>
                <AdminTableCell>
                  <div className="font-medium">{order.user_email || "—"}</div>
                  <div className="mt-1 font-mono text-sm text-muted-foreground break-all">
                    {order.user_uuid || "—"}
                  </div>
                  <Link
                    href={`/organizations/${order.org_uuid}`}
                    className="mt-2 block font-mono text-sm text-primary underline underline-offset-4 break-all"
                  >
                    {order.org_uuid || "No workspace"}
                  </Link>
                </AdminTableCell>
                <AdminTableCell>
                  <AdminStatusBadge
                    tone={
                      order.status === "paid"
                        ? "success"
                        : order.status === "deleted"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {order.status}
                  </AdminStatusBadge>
                </AdminTableCell>
                <AdminTableCell>
                  <div className="whitespace-nowrap font-medium tabular-nums">
                    {money(order.amount, order.currency)}
                  </div>
                  <div className="mt-1 whitespace-nowrap text-sm text-muted-foreground">
                    {formatAdminDate(order.paid_at)}
                  </div>
                </AdminTableCell>
                <AdminTableCell>
                  <div className="font-medium">{order.product_name || "—"}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {order.interval || "one-off"} · {order.credits} promised
                  </div>
                </AdminTableCell>
                <AdminTableCell className="tabular-nums">
                  {!owed ? (
                    <AdminStatusBadge>Not applicable</AdminStatusBadge>
                  ) : missing ? (
                    <AdminStatusBadge tone="danger">Missing</AdminStatusBadge>
                  ) : grant ? (
                    <span>
                      {grant.credits}
                      {grant.count > 1 && (
                        <AdminStatusBadge tone="danger" className="ml-2">
                          {grant.count} rows
                        </AdminStatusBadge>
                      )}
                    </span>
                  ) : (
                    "—"
                  )}
                </AdminTableCell>
              </AdminTableRow>
            );
          })}
        </AdminTableBody>
      </AdminTable>

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        unit="orders"
        href={pageHref}
      />

      <AdminPanel contentClassName="text-sm leading-6 text-muted-foreground">
        <p>
          <strong className="text-foreground">Granted</strong> compares{" "}
          <code>orders.credits</code> against ledger rows carrying that order
          number. A paid order marked{" "}
          <span className="text-destructive">Missing</span> is the defect{" "}
          <Link href="/reconciliation" className="underline underline-offset-4">
            reconciliation
          </Link>{" "}
          reports as <code>order_missing_credits</code>.
        </p>
      </AdminPanel>
    </div>
  );
}
