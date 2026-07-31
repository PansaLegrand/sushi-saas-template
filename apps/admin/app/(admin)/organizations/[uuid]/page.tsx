import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminPageHeader } from "@admin/components/admin-page-header";
import { ManageOrganizationSeats } from "@admin/components/manage-organization-seats";
import { AdminStatusBadge } from "@admin/components/admin-status-badge";
import { AdminTabs } from "@admin/components/admin-tabs";
import { ADMIN_RW, getAdminContext } from "@admin/lib/authz";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  asOrgUuid,
  findOrganizationByUuid,
  listMembersWithUsers,
} from "@/models/organization";
import { getOrdersByOrg } from "@/models/order";
import { listSubscriptionsByOrg } from "@/models/subscription";
import { getOrgCreditSummary } from "@/services/credit";
import { getPlanSnapshot } from "@/services/entitlements";
import { getOrganizationSeatSummary } from "@/services/organization-seats";

const SECTIONS = ["overview", "members", "credits", "orders"] as const;
type OrganizationSection = (typeof SECTIONS)[number];

function isOrganizationSection(
  value: string | undefined,
): value is OrganizationSection {
  return SECTIONS.some((section) => section === value);
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all font-mono text-sm" : "text-base"}>
        {value}
      </dd>
    </div>
  );
}

/**
 * One organization, end to end: identity, entitlement, people, credits, and
 * orders. Sections use links instead of client tabs so support can share the
 * exact operational view they are discussing.
 */
export default async function AdminOrganizationPage({
  params,
  searchParams,
}: {
  params: Promise<{ uuid: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const admin = await getAdminContext();
  if (!admin) return null;

  const [{ uuid }, { section: rawSection }] = await Promise.all([
    params,
    searchParams,
  ]);
  const section: OrganizationSection = isOrganizationSection(rawSection)
    ? rawSection
    : "overview";

  const org = await findOrganizationByUuid(uuid);
  if (!org) notFound();

  const [members, credits, plan, subscriptions, orders, seats] = await Promise.all([
    listMembersWithUsers(org.id),
    getOrgCreditSummary(org.uuid, {
      includeLedger: true,
      ledgerLimit: 50,
      includeAudit: true,
    }),
    getPlanSnapshot(asOrgUuid(org.uuid)),
    listSubscriptionsByOrg(org.uuid),
    getOrdersByOrg(org.uuid),
    getOrganizationSeatSummary(org.id, asOrgUuid(org.uuid)),
  ]);

  const sectionHref = (target: OrganizationSection) =>
    target === "overview"
      ? `/organizations/${org.uuid}`
      : `/organizations/${org.uuid}?section=${target}`;

  return (
    <div className="space-y-8">
      <Link
        href="/organizations"
        className="inline-flex min-h-10 items-center text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Organizations
      </Link>

      <AdminPageHeader
        eyebrow={org.is_personal ? "Personal workspace" : "Team workspace"}
        title={org.name}
        description={org.slug}
        actions={<AdminStatusBadge tone="info">{plan.name}</AdminStatusBadge>}
      />

      <AdminTabs
        label={`${org.name} sections`}
        items={[
          {
            href: sectionHref("overview"),
            label: "Overview",
            active: section === "overview",
          },
          {
            href: sectionHref("members"),
            label: "Members",
            active: section === "members",
            count: members.length,
          },
          {
            href: sectionHref("credits"),
            label: "Credits",
            active: section === "credits",
          },
          {
            href: sectionHref("orders"),
            label: "Orders",
            active: section === "orders",
            count: orders?.length ?? 0,
          },
        ]}
      />

      {section === "overview" ? (
        <div className="space-y-6">
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Identity</CardTitle>
                <CardDescription>
                  Stable identifiers for support and provider lookups.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-5 sm:grid-cols-2">
                  <DetailField
                    label="Organization UUID"
                    value={org.uuid}
                    mono
                  />
                  <DetailField
                    label="Stripe customer"
                    value={org.stripe_customer_id ?? "Not linked"}
                    mono
                  />
                  <DetailField
                    label="Workspace type"
                    value={org.is_personal ? "Personal" : "Team"}
                  />
                  <DetailField
                    label="Created"
                    value={org.created_at?.toISOString() ?? "—"}
                    mono
                  />
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Current plan</CardTitle>
                <CardDescription>
                  Resolved through the same entitlement path as the application.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <dl className="grid gap-5 sm:grid-cols-2">
                  <DetailField label="Tier" value={plan.name} />
                  <DetailField
                    label="Status"
                    value={plan.subscription?.status ?? "Free"}
                  />
                  <DetailField
                    label="Renews or ends"
                    value={plan.subscription?.currentPeriodEnd ?? "—"}
                    mono
                  />
                  <DetailField
                    label="Source"
                    value={plan.subscription?.source ?? "Catalog default"}
                  />
                </dl>

                {plan.subscription?.cancelAtPeriodEnd ? (
                  <Alert variant="warning">
                    <AlertTitle>Cancellation scheduled</AlertTitle>
                    <AlertDescription>
                      Access continues until{" "}
                      {plan.subscription.currentPeriodEnd ??
                        "the end of the current period"}
                      .
                    </AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <ManageOrganizationSeats
            orgUuid={org.uuid}
            canWrite={admin.role === ADMIN_RW}
            initial={seats}
          />

          <Card>
            <CardHeader>
              <CardTitle>Subscription history</CardTitle>
              <CardDescription>
                Provider statuses are shown verbatim for direct comparison with
                Stripe.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Period end</TableHead>
                    <TableHead>Cancellation</TableHead>
                    <TableHead>Stripe subscription</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-muted-foreground">
                        No subscription history. This workspace has never
                        subscribed.
                      </TableCell>
                    </TableRow>
                  ) : (
                    subscriptions.map((subscription) => (
                      <TableRow key={subscription.uuid}>
                        <TableCell className="font-medium">
                          {subscription.tier}
                        </TableCell>
                        <TableCell>{subscription.status}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {subscription.source}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {subscription.current_period_end?.toISOString() ??
                            "—"}
                        </TableCell>
                        <TableCell>
                          {subscription.cancel_at_period_end
                            ? "At period end"
                            : "No"}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {subscription.stripe_subscription_id ?? "Comped"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {section === "members" ? (
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              People who can access this workspace and their organization role.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>User UUID</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map(({ member, user }) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">{user.email}</TableCell>
                    <TableCell>{member.role}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {user.uuid}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {member.created_at?.toISOString() ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {section === "credits" ? (
        <Card>
          <CardHeader>
            <CardTitle>Credits</CardTitle>
            <CardDescription>
              Balance is spendable today. Ledger balance includes expired grants
              and can therefore differ.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Available balance", credits.balance],
                ["Granted", credits.granted],
                ["Consumed", credits.consumed],
                ["Expired", credits.expired],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="rounded-lg border border-border bg-muted/30 p-4"
                >
                  <dt className="text-sm font-medium text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="mt-2 text-2xl font-semibold tracking-tight">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="text-right">Balance after</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Context</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credits.ledger.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground">
                      No credit activity.
                    </TableCell>
                  </TableRow>
                ) : (
                  credits.ledger.map((entry) => (
                    <TableRow key={entry.transNo} className="align-top">
                      <TableCell className="font-mono text-sm">
                        {entry.createdAt}
                      </TableCell>
                      <TableCell>{entry.transType}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {entry.credits}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm tabular-nums">
                        {entry.balanceAfter ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {entry.actor ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {entry.orderNo || "—"}
                      </TableCell>
                      <TableCell>
                        <code className="block max-w-md whitespace-pre-wrap break-words text-sm leading-5">
                          {entry.metadata
                            ? Object.entries(entry.metadata)
                                .map(
                                  ([key, value]) => `${key}=${String(value)}`,
                                )
                                .join("\n")
                            : "—"}
                        </code>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {section === "orders" ? (
        <Card>
          <CardHeader>
            <CardTitle>Paid orders</CardTitle>
            <CardDescription>
              Successful purchases associated with this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order number</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead>Paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(orders ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      No paid orders.
                    </TableCell>
                  </TableRow>
                ) : (
                  (orders ?? []).map((order) => (
                    <TableRow key={order.order_no}>
                      <TableCell className="font-mono text-sm">
                        {order.order_no}
                      </TableCell>
                      <TableCell>{order.product_name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {order.amount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {order.credits}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {order.paid_at?.toISOString() ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
