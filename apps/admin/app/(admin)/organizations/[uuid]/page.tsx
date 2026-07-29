import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminPageHeader } from "@admin/components/admin-page-header";
import { getAdminContext } from "@admin/lib/authz";
import {
  asOrgUuid,
  findOrganizationByUuid,
  listMembersWithUsers,
} from "@/models/organization";
import { getOrdersByOrg } from "@/models/order";
import { listSubscriptionsByOrg } from "@/models/subscription";
import { getOrgCreditSummary } from "@/services/credit";
import { getPlanSnapshot } from "@/services/entitlements";

/**
 * One organization, end to end: who is in it, what it is entitled to, what it
 * paid, and where its credits went.
 *
 * This is the screen the console was missing. Everything here is keyed on the
 * org uuid directly — no `findPersonalOrganizationByUserUuid` anywhere — which
 * is what makes a team's billing reachable at all.
 *
 * Read-only. Granting credits and comping a tier still happen from the overview,
 * against a user's personal workspace; moving those to be org-targeted is its own
 * change, because a write path that can now hit any tenant deserves more than a
 * new argument.
 */

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-sm ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

export default async function AdminOrganizationPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const admin = await getAdminContext();
  if (!admin) return null;

  const { uuid } = await params;
  const org = await findOrganizationByUuid(uuid);
  if (!org) notFound();

  const [members, credits, plan, subscriptions, orders] = await Promise.all([
    listMembersWithUsers(org.id),
    // The audit columns: this is an admin surface, so `actor` and `metadata`
    // are included. See the note on `includeAudit` in src/services/credit.ts.
    getOrgCreditSummary(org.uuid, {
      includeLedger: true,
      ledgerLimit: 50,
      includeAudit: true,
    }),
    getPlanSnapshot(asOrgUuid(org.uuid)),
    // Every subscription, not just the active one. A canceled row beside a new
    // one is the shape of an upgrade, and hiding it makes a support question
    // unanswerable.
    listSubscriptionsByOrg(org.uuid),
    getOrdersByOrg(org.uuid),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/organizations"
        className="inline-flex text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Organizations
      </Link>
      <AdminPageHeader
        eyebrow="Organization"
        title={org.name}
        description={`${org.is_personal ? "Personal workspace" : "Team"} · ${org.slug}`}
      />

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-medium">Identity</h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Org UUID" value={org.uuid} mono />
          <Field
            label="Stripe customer"
            value={org.stripe_customer_id ?? "—"}
            mono
          />
          <Field
            label="Created"
            value={org.created_at?.toISOString() ?? "—"}
            mono
          />
        </dl>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-lg font-medium">Plan</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          What this organization is entitled to right now, resolved through the
          same path the app uses.
        </p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Tier" value={plan.name} />
          <Field label="Status" value={plan.subscription?.status ?? "—"} />
          <Field
            label="Renews / ends"
            value={plan.subscription?.currentPeriodEnd ?? "—"}
            mono
          />
          <Field label="Source" value={plan.subscription?.source ?? "—"} />
        </dl>
        {plan.subscription?.cancelAtPeriodEnd && (
          // The answer to "I cancelled and I am still being charged": they are
          // still on the tier they paid for, until the period ends.
          <p className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-sm">
            Cancels at period end — access continues until{" "}
            {plan.subscription.currentPeriodEnd ?? "the end of the period"}.
          </p>
        )}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-lg font-medium">Subscriptions</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Stripe&apos;s own vocabulary, stored verbatim so this table can be
          compared against the Stripe dashboard without a mapping.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Tier</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Source</th>
                <th className="py-2 pr-4">Period end</th>
                <th className="py-2 pr-4">Cancels?</th>
                <th className="py-2 pr-4">Ended</th>
                <th className="py-2 pr-4">Stripe subscription</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.length === 0 && (
                <tr className="border-t">
                  <td className="py-2 text-muted-foreground" colSpan={7}>
                    No subscription rows. On the free tier, or never subscribed.
                  </td>
                </tr>
              )}
              {subscriptions.map((sub) => (
                <tr key={sub.uuid} className="border-t">
                  <td className="py-2 pr-4">{sub.tier}</td>
                  <td className="py-2 pr-4">{sub.status}</td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {sub.source}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {sub.current_period_end?.toISOString() ?? "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {sub.cancel_at_period_end ? "yes" : "no"}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {sub.ended_at?.toISOString() ?? "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {sub.stripe_subscription_id ?? "— (comped)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-medium">Members ({members.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">User UUID</th>
                <th className="py-2 pr-4">Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map(({ member, user }) => (
                <tr key={member.id} className="border-t">
                  <td className="py-2 pr-4">{user.email}</td>
                  <td className="py-2 pr-4">{member.role}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{user.uuid}</td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {member.created_at?.toISOString() ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-lg font-medium">Credits</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Pooled across the whole organization. <strong>Balance</strong> is what
          can be spent today; <strong>Balance after</strong> is the running
          ledger total, which counts expired grants and so will differ.
        </p>
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Balance", credits.balance],
            ["Granted", credits.granted],
            ["Consumed", credits.consumed],
            ["Expired", credits.expired],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded border p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg font-medium">{value}</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">When</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Credits</th>
                <th className="py-2 pr-4">Balance after</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Order</th>
                <th className="py-2 pr-4">Context</th>
              </tr>
            </thead>
            <tbody>
              {credits.ledger.length === 0 && (
                <tr className="border-t">
                  <td className="py-2 text-muted-foreground" colSpan={7}>
                    No ledger rows.
                  </td>
                </tr>
              )}
              {credits.ledger.map((entry) => (
                <tr key={entry.transNo} className="border-t align-top">
                  <td className="py-2 pr-4 font-mono text-xs">
                    {entry.createdAt}
                  </td>
                  <td className="py-2 pr-4">{entry.transType}</td>
                  <td className="py-2 pr-4">{entry.credits}</td>
                  {/* A dash, not a zero: null means the row predates migration
                      0018, and a 0 would read as a drained balance. */}
                  <td className="py-2 pr-4 font-mono text-xs">
                    {entry.balanceAfter ?? "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {entry.actor ?? "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {entry.orderNo || "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono text-[10px]">
                    {entry.metadata
                      ? Object.entries(entry.metadata)
                          .map(([key, value]) => `${key}=${String(value)}`)
                          .join("\n")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-medium">
          Paid orders ({orders?.length ?? 0})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Order No</th>
                <th className="py-2 pr-4">Product</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Credits</th>
                <th className="py-2 pr-4">Paid At</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).length === 0 && (
                <tr className="border-t">
                  <td className="py-2 text-muted-foreground" colSpan={5}>
                    No paid orders.
                  </td>
                </tr>
              )}
              {(orders ?? []).map((order) => (
                <tr key={order.order_no} className="border-t">
                  <td className="py-2 pr-4 font-mono text-xs">
                    {order.order_no}
                  </td>
                  <td className="py-2 pr-4">{order.product_name ?? "—"}</td>
                  <td className="py-2 pr-4">{order.amount}</td>
                  <td className="py-2 pr-4">{order.credits}</td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {order.paid_at?.toISOString() ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
