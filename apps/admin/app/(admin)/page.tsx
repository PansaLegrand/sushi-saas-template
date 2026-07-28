import { getAdminContext } from "@admin/lib/authz";
import {
  countAdminBannedUsers,
  countAdminUsers,
  countAdminUsersSince,
  listAdminPaidOrders,
  listAdminUsers,
} from "@admin/lib/data";
import GrantCreditsPanel from "@admin/components/grant-credits";
import ManagePlanPanel from "@admin/components/manage-plan";
import { StatCard } from "@/components/ui/card";
import { describePlans } from "@/services/entitlements";
import { countStripeWebhookEventsByStatus } from "@/models/stripe-webhook-event";
import { countSubscriptionsByStatus } from "@/models/subscription";
import Link from "next/link";

const SIGNUP_WINDOW_DAYS = 7;

/**
 * The overview.
 *
 * The tiles at the top are not a dashboard in the analytics sense, and that is
 * a decision rather than an unfinished job. Each one is a number that changes
 * what the operator does next: signups this week against the product's own
 * shape is where a bot wave first shows as a number; past-due subscriptions are
 * payments to chase; parked Stripe events do not retry on their own; suspended
 * accounts say whether moderation is keeping up.
 *
 * Deliberately absent: revenue, conversion, churn, and anything else the Stripe
 * dashboard already renders better, plus credits outstanding — a finance figure
 * with no action attached to it, which would need a global ledger aggregate to
 * compute honestly. A tile nobody acts on trains people to stop reading the row.
 */
export default async function AdminHomePage() {
  const admin = await getAdminContext();
  // Layout already guards; this is a type-safety fallback.
  const canWrite = admin?.role === "admin_rw";

  const signupWindowStart = new Date(
    Date.now() - SIGNUP_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  const [
    users,
    orders,
    webhookStatuses,
    userTotal,
    recentSignups,
    suspended,
    subscriptionStatuses,
  ] = await Promise.all([
    listAdminUsers({ limit: 20 }),
    listAdminPaidOrders(1, 20),
    countStripeWebhookEventsByStatus(),
    countAdminUsers(),
    countAdminUsersSince(signupWindowStart),
    countAdminBannedUsers(),
    countSubscriptionsByStatus(),
  ]);

  // Surfaced on the overview rather than only on its own page: a queue you have
  // to navigate to is a queue you check when you already suspect a problem.
  const needsAction = webhookStatuses.action_required ?? 0;

  // Trialing counts as live: it is a customer with a working payment path, and
  // splitting it out would understate the number an operator sanity-checks
  // against Stripe. `past_due` is separate because it is a thing to *do*.
  const liveSubscriptions =
    (subscriptionStatuses.active ?? 0) + (subscriptionStatuses.trialing ?? 0);
  const pastDue = subscriptionStatuses.past_due ?? 0;

  // Resolved server-side so the console offers exactly the tiers the catalog
  // defines, rather than a hardcoded list that drifts from it.
  const tiers = describePlans().map(({ tier, name }) => ({ tier, name }));

  return (
    <div className="grid grid-cols-1 gap-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={`Users · +${recentSignups} in ${SIGNUP_WINDOW_DAYS}d`}
          value={userTotal}
        />
        <StatCard
          label={pastDue > 0 ? `Subscriptions · ${pastDue} past due` : "Subscriptions"}
          value={liveSubscriptions}
          className={pastDue > 0 ? "border-destructive/40 bg-destructive/5" : ""}
        />
        <StatCard
          label="Suspended accounts"
          value={suspended}
          className={suspended > 0 ? "border-destructive/40 bg-destructive/5" : ""}
        />
        <StatCard
          label="Stripe events to resolve"
          value={needsAction}
          className={needsAction > 0 ? "border-destructive/40 bg-destructive/5" : ""}
        />
      </section>

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

      <section className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Organizations</h2>
          <Link href="/organizations" className="text-sm underline">View all</Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          The tenant billing attaches to: pooled credits, the plan, and the
          Stripe customer. Search by name, slug, or <code>cus_…</code>.
        </p>
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
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Moderation</h2>
          <Link href="/moderation" className="text-sm underline">View all</Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Suspend an abusive account and keep its address from registering
          again. Suspending blocks sign-in and revokes live sessions; it does not
          delete anything.
        </p>
      </section>

      <section className="rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Users (latest 20)</h2>
          {/* The tools below take a uuid, and this table only ever holds the
              newest twenty. Search is where an operator gets the other ones. */}
          <Link href="/users" className="text-sm underline">
            Search all users
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">UUID</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
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
                    {u.banned_at ? (
                      <span className="text-destructive">Suspended</span>
                    ) : (
                      "Active"
                    )}
                  </td>
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Paid Orders (latest 20)</h2>
          {/* The full table answers the question this one cannot: whether each
              order's credits actually reached the ledger. */}
          <Link href="/orders" className="text-sm underline">
            Search all orders
          </Link>
        </div>
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
        <h2 className="mb-1 text-lg font-medium">User Credits</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Acts on the user&apos;s <strong>personal workspace</strong>. Credits
          pool at the organization, so for a team use{" "}
          <Link href="/organizations" className="underline">
            Organizations
          </Link>
          .
        </p>
        <GrantCreditsPanel canWrite={!!canWrite} />
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-1 text-lg font-medium">User Plan</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Look up what a user is entitled to, and comp them onto a tier. Paid
          subscriptions are managed in Stripe. Like the panel above, this reads
          and writes the user&apos;s <strong>personal workspace</strong> — a
          team&apos;s plan lives on{" "}
          <Link href="/organizations" className="underline">
            its organization
          </Link>
          .
        </p>
        <ManagePlanPanel canWrite={!!canWrite} tiers={tiers} />
      </section>
    </div>
  );
}
