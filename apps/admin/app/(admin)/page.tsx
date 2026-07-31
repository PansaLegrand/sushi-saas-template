import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  MessageSquareText,
  ShieldAlert,
  Users,
  Webhook,
} from "lucide-react";
import Link from "next/link";

import { AdminPageHeader } from "@admin/components/admin-page-header";
import {
  AdminStatusBadge,
  type AdminStatusTone,
} from "@admin/components/admin-status-badge";
import GrantCreditsPanel from "@admin/components/grant-credits";
import ManagePlanPanel from "@admin/components/manage-plan";
import { getAdminContext } from "@admin/lib/authz";
import {
  countAdminBannedUsers,
  countAdminUsers,
  countAdminUsersSince,
  listAdminPaidOrders,
  listAdminUsers,
} from "@admin/lib/data";
import { formatAdminDate, formatAdminMoney } from "@admin/lib/format";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { countStripeWebhookEventsByStatus } from "@/models/stripe-webhook-event";
import { countSubscriptionsByStatus } from "@/models/subscription";
import { describePlans } from "@/services/entitlements";
import { cn } from "@/lib/utils";

const SIGNUP_WINDOW_DAYS = 7;

function MetricCard({
  label,
  value,
  detail,
  href,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: number;
  detail: string;
  href: string;
  icon: LucideIcon;
  tone?: AdminStatusTone;
}) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/30 bg-destructive/[0.04]"
      : tone === "warning"
        ? "border-warning/30 bg-warning/[0.05]"
        : "";

  return (
    <Link
      href={href}
      className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card
        className={cn(
          "h-full transition-colors group-hover:border-foreground/25 group-hover:bg-card/80",
          toneClass,
        )}
      >
        <CardContent className="flex h-full items-start justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">
              {value}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {detail}
            </p>
          </div>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-foreground">
            <Icon aria-hidden className="size-5" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

function AttentionItem({
  label,
  detail,
  count,
  href,
  tone,
}: {
  label: string;
  detail: string;
  count: number;
  href: string;
  tone: AdminStatusTone;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-start justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            {detail}
          </p>
        </div>
        <AdminStatusBadge tone={tone} className="shrink-0">
          {count}
        </AdminStatusBadge>
      </Link>
    </li>
  );
}

function QuickLink({
  href,
  label,
  description,
  icon: Icon,
}: {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground group-hover:text-foreground">
          <Icon aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{label}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {description}
          </span>
        </span>
        <ArrowRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      </Link>
    </li>
  );
}

/**
 * Operational overview.
 *
 * Every headline number points to an action. Revenue analytics, conversion, and
 * churn remain in Stripe, where they are more complete. The console instead
 * leads with states an operator can resolve: sign-up changes, payment trouble,
 * suspended accounts, and webhook events waiting for a person.
 */
export default async function AdminHomePage() {
  const admin = await getAdminContext();
  // Layout already guards; this is a type-safety fallback.
  const canWrite = admin?.role === "admin_rw";

  const signupWindowStart = new Date(
    Date.now() - SIGNUP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
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

  const needsAction = webhookStatuses.action_required ?? 0;
  const liveSubscriptions =
    (subscriptionStatuses.active ?? 0) + (subscriptionStatuses.trialing ?? 0);
  const pastDue = subscriptionStatuses.past_due ?? 0;
  const attentionTotal = pastDue + suspended + needsAction;

  // Resolved server-side so the console offers exactly the tiers the catalog
  // defines, rather than a hardcoded list that drifts from it.
  const tiers = describePlans().map(({ tier, name }) => ({ tier, name }));

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow="Operations"
        title="Overview"
        description="Monitor customer activity, billing health, and queues that need a decision."
        actions={
          <AdminStatusBadge tone={canWrite ? "success" : "neutral"}>
            {canWrite ? "Read & write access" : "Read-only access"}
          </AdminStatusBadge>
        }
      />

      <section aria-labelledby="overview-metrics-heading">
        <h2 id="overview-metrics-heading" className="sr-only">
          Operational metrics
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Total users"
            value={userTotal}
            detail={`+${recentSignups} joined in the last ${SIGNUP_WINDOW_DAYS} days`}
            href="/users"
            icon={Users}
          />
          <MetricCard
            label="Live subscriptions"
            value={liveSubscriptions}
            detail={
              pastDue > 0
                ? `${pastDue} payment${pastDue === 1 ? "" : "s"} past due`
                : "No past-due subscriptions"
            }
            href="/organizations"
            icon={CreditCard}
            tone={pastDue > 0 ? "warning" : "neutral"}
          />
          <MetricCard
            label="Suspended accounts"
            value={suspended}
            detail={
              suspended > 0
                ? "Review moderation activity"
                : "No accounts currently suspended"
            }
            href="/moderation"
            icon={ShieldAlert}
            tone={suspended > 0 ? "danger" : "neutral"}
          />
          <MetricCard
            label="Stripe events"
            value={needsAction}
            detail={
              needsAction > 0
                ? "Waiting for an operator decision"
                : "No parked events need attention"
            }
            href="/stripe-events?status=action_required"
            icon={Webhook}
            tone={needsAction > 0 ? "danger" : "neutral"}
          />
        </div>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <aside className="space-y-6 xl:order-2">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">Needs attention</CardTitle>
                <AdminStatusBadge
                  tone={attentionTotal > 0 ? "danger" : "success"}
                >
                  {attentionTotal > 0 ? attentionTotal : "All clear"}
                </AdminStatusBadge>
              </div>
              <CardDescription>
                Queues that do not disappear without an operator.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {attentionTotal === 0 ? (
                <div className="flex items-start gap-3 rounded-lg border border-success/25 bg-success/10 p-3">
                  <CheckCircle2
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-success"
                  />
                  <div>
                    <p className="text-sm font-medium">No open queues</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      Payments, moderation, and Stripe processing look healthy.
                    </p>
                  </div>
                </div>
              ) : (
                <ul className="space-y-2">
                  {pastDue > 0 ? (
                    <AttentionItem
                      label="Past-due subscriptions"
                      detail="Customers may need a payment-method update."
                      count={pastDue}
                      href="/organizations"
                      tone="warning"
                    />
                  ) : null}
                  {needsAction > 0 ? (
                    <AttentionItem
                      label="Parked Stripe events"
                      detail="These events will not retry on their own."
                      count={needsAction}
                      href="/stripe-events?status=action_required"
                      tone="danger"
                    />
                  ) : null}
                  {suspended > 0 ? (
                    <AttentionItem
                      label="Suspended accounts"
                      detail="Review account and blocklist decisions."
                      count={suspended}
                      href="/moderation"
                      tone="danger"
                    />
                  ) : null}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Quick access</CardTitle>
              <CardDescription>Common operational workspaces.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="-mx-2">
                <QuickLink
                  href="/organizations"
                  label="Organizations"
                  description="Plans, credits, members, and Stripe customers"
                  icon={Building2}
                />
                <QuickLink
                  href="/feedbacks"
                  label="Feedback"
                  description="Read what customers are telling you"
                  icon={MessageSquareText}
                />
                <QuickLink
                  href="/reservations"
                  label="Reservations"
                  description="Review upcoming and past appointments"
                  icon={CalendarDays}
                />
              </ul>
            </CardContent>
          </Card>
        </aside>

        <div className="space-y-6 xl:order-1">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">Recent users</CardTitle>
                <CardDescription>
                  The latest 20 accounts created.
                </CardDescription>
              </div>
              <Link
                href="/users"
                className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Search all
              </Link>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[42rem] text-sm">
                  <caption className="sr-only">
                    The 20 most recently created user accounts
                  </caption>
                  <thead className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-6 py-3 font-medium">
                        Account
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Role
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Created
                      </th>
                      <th scope="col" className="px-6 py-3 font-medium">
                        Last sign-in
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-6 py-8 text-center text-muted-foreground"
                        >
                          No users yet.
                        </td>
                      </tr>
                    ) : null}
                    {users.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b border-border last:border-b-0 hover:bg-muted/25"
                      >
                        <td className="px-6 py-3">
                          <p className="font-medium">{user.email}</p>
                          <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">
                            {user.uuid}
                          </p>
                        </td>
                        <td className="px-4 py-3">{user.role ?? "user"}</td>
                        <td className="px-4 py-3">
                          <AdminStatusBadge
                            tone={user.banned_at ? "danger" : "success"}
                          >
                            {user.banned_at ? "Suspended" : "Active"}
                          </AdminStatusBadge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                          {formatAdminDate(user.created_at)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3 text-xs text-muted-foreground">
                          {formatAdminDate(user.last_signin_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">Recent paid orders</CardTitle>
                <CardDescription>
                  The latest 20 completed payments.
                </CardDescription>
              </div>
              <Link
                href="/orders"
                className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Search all
              </Link>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[42rem] text-sm">
                  <caption className="sr-only">
                    The 20 most recent paid orders
                  </caption>
                  <thead className="border-y border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-6 py-3 font-medium">
                        Order
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        User
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-3 text-right font-medium"
                      >
                        Amount
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-3 text-right font-medium"
                      >
                        Credits
                      </th>
                      <th scope="col" className="px-6 py-3 font-medium">
                        Paid
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-6 py-8 text-center text-muted-foreground"
                        >
                          No paid orders yet.
                        </td>
                      </tr>
                    ) : null}
                    {orders.map((order) => (
                      <tr
                        key={order.id}
                        className="border-b border-border last:border-b-0 hover:bg-muted/25"
                      >
                        <td className="px-6 py-3 font-mono text-xs">
                          {order.order_no}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {order.user_uuid}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium">
                          {formatAdminMoney(order.amount, order.currency)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {order.credits}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3 text-xs text-muted-foreground">
                          {formatAdminDate(order.paid_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <section aria-labelledby="operator-tools-heading" className="space-y-4">
        <div>
          <h2
            id="operator-tools-heading"
            className="text-lg font-semibold tracking-tight"
          >
            Operator tools
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These user-targeted tools act on a personal workspace. Use an
            organization page to inspect a team.
          </p>
        </div>

        <div className="grid items-start gap-6 2xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">User credits</CardTitle>
              <CardDescription>
                Inspect a personal credit ledger or grant an audited adjustment.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GrantCreditsPanel canWrite={!!canWrite} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">User plan</CardTitle>
              <CardDescription>
                Inspect entitlements or grant complimentary access. Paid
                subscriptions remain managed in Stripe.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ManagePlanPanel canWrite={!!canWrite} tiers={tiers} />
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
