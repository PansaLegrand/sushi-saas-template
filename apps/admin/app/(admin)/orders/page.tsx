import Link from "next/link";

import { AdminPageHeader } from "@admin/components/admin-page-header";
import { getAdminContext } from "@admin/lib/authz";
import {
  countAdminOrders,
  countAdminOrdersByStatus,
  listAdminOrders,
} from "@admin/lib/data";
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
    <div className="space-y-4">
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

      <nav className="flex flex-wrap gap-2 text-sm">
        {STATUS_FILTERS.map((filter) => {
          const active = (status ?? "") === filter.value;
          const count = filter.value ? (byStatus[filter.value] ?? 0) : allTotal;

          return (
            <Link
              key={filter.value || "all"}
              href={filterHref(filter.value)}
              className={`rounded border px-3 py-1 ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {filter.label} ({count})
            </Link>
          );
        })}
      </nav>

      {/* A GET form, so a search is a URL an operator can paste into a ticket. */}
      <form method="get" className="flex gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <input
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder="Order no, sub_…, org, user uuid or email"
          className="w-full max-w-md rounded border bg-background px-3 py-2 text-sm"
          aria-label="Search orders"
        />
        <button type="submit" className="rounded border px-3 py-2 text-sm">
          Search
        </button>
        {query && (
          <Link
            href={filterHref(status ?? "")}
            className="self-center text-sm text-muted-foreground underline"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 pl-3 pr-4">Order</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Organization</th>
              <th className="py-2 pr-4">User</th>
              <th className="py-2 pr-4">Amount</th>
              {/* The two that must agree. They disagree exactly when the money
                  landed and the ledger did not. */}
              <th className="py-2 pr-4">Credits promised</th>
              <th className="py-2 pr-4">Granted</th>
              <th className="py-2 pr-4">Product</th>
              <th className="py-2 pr-4">Paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-muted-foreground" colSpan={9}>
                  No orders{query ? ` matching "${query}"` : ""}.
                </td>
              </tr>
            )}
            {rows.map((order) => {
              const shape = describeOrderNo(order.order_no);
              const grant = grantsByOrder.get(order.order_no);
              const paid = order.status === "paid";
              const owed = order.credits > 0;
              // Only meaningful for a paid order that promised credits: an
              // unpaid one is *supposed* to have no ledger row.
              const missing = paid && owed && !grant;

              return (
                <tr key={order.id} className="border-t align-top">
                  <td className="py-2 pl-3 pr-4">
                    <div className="font-mono text-xs break-all select-all">
                      {order.order_no}
                    </div>
                    <div
                      className="text-[10px] text-muted-foreground"
                      title={shape.hint}
                    >
                      {shape.kind}
                      {order.sub_id ? ` · ${order.sub_id}` : ""}
                    </div>
                  </td>
                  <td className="py-2 pr-4">{order.status}</td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/organizations/${order.org_uuid}`}
                      className="font-mono text-xs underline break-all"
                    >
                      {order.org_uuid || "—"}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="text-xs">{order.user_email || "—"}</div>
                    <div className="font-mono text-[10px] text-muted-foreground break-all">
                      {order.user_uuid || "—"}
                    </div>
                  </td>
                  <td className="py-2 pr-4">
                    {money(order.amount, order.currency)}
                  </td>
                  <td className="py-2 pr-4">{order.credits}</td>
                  <td className="py-2 pr-4">
                    {!owed ? (
                      <span className="text-muted-foreground">n/a</span>
                    ) : missing ? (
                      <span className="text-destructive">none</span>
                    ) : grant ? (
                      <>
                        {grant.credits}
                        {/* One order pays out once. Two rows means two grants
                            for one payment, which is the opposite defect and
                            just as worth seeing. */}
                        {grant.count > 1 && (
                          <span className="ml-1 text-destructive">
                            ({grant.count} rows)
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="text-xs">{order.product_name || "—"}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {order.interval || "one-off"}
                    </div>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {order.paid_at?.toISOString() ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        unit="orders"
        href={pageHref}
      />

      <p className="text-xs text-muted-foreground">
        <strong>Granted</strong> compares <code>orders.credits</code> against
        the ledger rows carrying that order number. A paid order promising
        credits with <span className="text-destructive">none</span> granted is
        the defect{" "}
        <Link href="/reconciliation" className="underline">
          reconciliation
        </Link>{" "}
        reports as <code>order_missing_credits</code>.
      </p>
    </div>
  );
}
