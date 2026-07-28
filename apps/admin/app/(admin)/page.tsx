import { getAdminContext } from "@admin/lib/authz";
import { listAdminPaidOrders, listAdminUsers } from "@admin/lib/data";
import GrantCreditsPanel from "@admin/components/grant-credits";
import ManagePlanPanel from "@admin/components/manage-plan";
import { describePlans } from "@/services/entitlements";
import { countStripeWebhookEventsByStatus } from "@/models/stripe-webhook-event";
import Link from "next/link";

export default async function AdminHomePage() {
  const admin = await getAdminContext();
  // Layout already guards; this is a type-safety fallback.
  const canWrite = admin?.role === "admin_rw";

  const [users, orders, webhookStatuses] = await Promise.all([
    listAdminUsers(1, 20),
    listAdminPaidOrders(1, 20),
    countStripeWebhookEventsByStatus(),
  ]);

  // Surfaced on the overview rather than only on its own page: a queue you have
  // to navigate to is a queue you check when you already suspect a problem.
  const needsAction = webhookStatuses.action_required ?? 0;

  // Resolved server-side so the console offers exactly the tiers the catalog
  // defines, rather than a hardcoded list that drifts from it.
  const tiers = describePlans().map(({ tier, name }) => ({ tier, name }));

  return (
    <div className="grid grid-cols-1 gap-6">
      <section className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Feedbacks</h2>
          <Link href="/feedbacks" className="text-sm underline">View all</Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Read user feedback and improve your product.</p>
      </section>

      <section className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Reservations</h2>
          <Link href="/reservations" className="text-sm underline">View all</Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Check upcoming and past appointments.</p>
      </section>

      <section className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Affiliates</h2>
          <Link href="/affiliates" className="text-sm underline">View all</Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Review attribution, paid referrals, and rewards.</p>
      </section>

      <section
        className={`rounded-lg border p-4 ${
          needsAction > 0 ? "border-destructive/40 bg-destructive/5" : ""
        }`}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Stripe Events</h2>
          <Link href="/stripe-events" className="text-sm underline">View all</Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {needsAction > 0
            ? `${needsAction} event${needsAction === 1 ? "" : "s"} need a decision — these do not retry on their own.`
            : "Webhook deliveries, and anything parked for a human. Nothing needs attention."}
        </p>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-medium">Users (latest 20)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">UUID</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Created</th>
                <th className="py-2 pr-4">Last Sign-in</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="py-2 pr-4">{u.email}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{u.uuid}</td>
                  <td className="py-2 pr-4">{(u as any).role ?? "user"}</td>
                  <td className="py-2 pr-4">
                    {u.created_at ? u.created_at.toISOString() : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {u.last_signin_at ? u.last_signin_at.toISOString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-medium">Paid Orders (latest 20)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Order No</th>
                <th className="py-2 pr-4">User UUID</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Credits</th>
                <th className="py-2 pr-4">Paid At</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="py-2 pr-4 font-mono text-xs">{o.order_no}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{o.user_uuid}</td>
                  <td className="py-2 pr-4">{o.amount}</td>
                  <td className="py-2 pr-4">{o.credits}</td>
                  <td className="py-2 pr-4">
                    {o.paid_at ? o.paid_at.toISOString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-medium">User Credits</h2>
        <GrantCreditsPanel canWrite={!!canWrite} />
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-lg font-medium">User Plan</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Look up what a user is entitled to, and comp them onto a tier. Paid
          subscriptions are managed in Stripe.
        </p>
        <ManagePlanPanel canWrite={!!canWrite} tiers={tiers} />
      </section>
    </div>
  );
}
