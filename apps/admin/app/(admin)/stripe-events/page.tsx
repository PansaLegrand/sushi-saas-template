import { AdminPanel } from "@admin/components/admin-panel";
import { AdminPageHeader } from "@admin/components/admin-page-header";
import {
  AdminStatusBadge,
  type AdminStatusTone,
} from "@admin/components/admin-status-badge";
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
  AdminToolbar,
} from "@admin/components/admin-toolbar";
import { getAdminContext } from "@admin/lib/authz";
import { formatAdminDate } from "@admin/lib/format";
import { Pager } from "@admin/components/pager";
import ResolveStripeEvent from "@admin/components/resolve-stripe-event";
import {
  RESOLVABLE_STATUSES,
  countStripeWebhookEventsByStatus,
  listStripeWebhookEvents,
} from "@/models/stripe-webhook-event";

/**
 * The Stripe webhook queue.
 *
 * This page exists because `action_required` was otherwise a status nobody could
 * see. The webhook parks an event a human has to resolve — an unmapped price, a
 * refund whose credits are already spent — and until now the only surfaces were a
 * Slack message and a CLI script. A status with no console is a status that gets
 * discovered when a customer complains.
 *
 * **Read-only on purpose.** The obvious next feature is a "replay" button, and
 * that is a write path into billing: it needs `admin_rw`, an audit log entry, and
 * a think about what replaying a half-applied event does. Shipping the view first
 * makes the queue visible today without pretending the hard part is done.
 *
 * The event payload is deliberately not fetched or shown. It holds the whole
 * Stripe object — for a checkout session that includes the customer's email and
 * address — and the denormalized columns answer the operational questions
 * without it.
 */

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "action_required", label: "Needs action" },
  { value: "failed", label: "Failed" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "resolved", label: "Resolved" },
] as const;

function StatusBadge({ status }: { status: string }) {
  // `action_required` is the one that means "you, now" — the others are either
  // fine or will retry themselves, so only it gets the loud treatment.
  const tone: AdminStatusTone =
    status === "action_required"
      ? "danger"
      : status === "failed"
        ? "warning"
        : status === "completed" || status === "resolved"
          ? "success"
          : "neutral";

  return <AdminStatusBadge tone={tone}>{status}</AdminStatusBadge>;
}

export default async function AdminStripeEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  // The layout already guards; this is the same type-safety fallback the other
  // admin pages use.
  const admin = await getAdminContext();
  if (!admin) return null;
  const canWrite = admin.role === "admin_rw";

  const { status: rawStatus, page: rawPage } = await searchParams;

  // Only statuses this app writes. An arbitrary query value would otherwise
  // reach the query and return a confusing empty table.
  const status = STATUS_FILTERS.some((f) => f.value && f.value === rawStatus)
    ? rawStatus
    : undefined;

  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);
  const limit = 50;

  const [events, byStatus] = await Promise.all([
    listStripeWebhookEvents({ status, page, limit }),
    countStripeWebhookEventsByStatus(),
  ]);

  const needsAction = byStatus.action_required ?? 0;
  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  // The pager counts what the filter selected, not the whole table — otherwise
  // filtering to nine parked events offers pages of nothing.
  const filteredTotal = status ? (byStatus[status] ?? 0) : total;

  const href = (value: string) =>
    value ? `/stripe-events?status=${value}` : "/stripe-events";

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Stripe events"
        description="Every webhook delivery this deployment recorded."
        actions={
          <p className="text-sm text-muted-foreground">Total: {total}</p>
        }
      />

      {needsAction > 0 && (
        <AdminPanel
          title={`${needsAction} event${needsAction === 1 ? "" : "s"} need a decision`}
          description="These events do not retry automatically because Stripe already received a successful response."
          className="border-destructive/30 bg-destructive/[0.04]"
          contentClassName="space-y-3 text-sm leading-6"
        >
          <p>
            <strong>To re-run one:</strong> fix the cause, then press Resend in
            the Stripe dashboard. The redelivery reclaims the row and processes
            it against Stripe&apos;s current state.
          </p>
          {/* The two exits, and they are not interchangeable. Replay re-runs the
              work; Resolve records that a person did it elsewhere. Saying which
              is which here is the difference between an operator clearing the
              queue and an operator clearing the evidence. */}
          <p className="text-muted-foreground">
            <strong>If you handled it outside this system</strong> — refunded by
            hand, accepted a dispute — use Resolve to close it with a note.
            Resolving is final: later redeliveries are acknowledged and not
            re-run.
          </p>
        </AdminPanel>
      )}

      <AdminToolbar>
        <AdminFilterNav label="Filter Stripe events by status">
          {STATUS_FILTERS.map((filter) => {
            const count = filter.value ? (byStatus[filter.value] ?? 0) : total;

            return (
              <AdminFilterLink
                key={filter.value || "all"}
                href={href(filter.value)}
                active={(status ?? "") === filter.value}
                count={count}
              >
                {filter.label}
              </AdminFilterLink>
            );
          })}
        </AdminFilterNav>
      </AdminToolbar>

      <AdminTable caption="Stripe webhook events" className="min-w-[80rem]">
        <AdminTableHeader>
          <tr>
            <AdminTableHead>Event</AdminTableHead>
            <AdminTableHead>Status</AdminTableHead>
            <AdminTableHead>Received</AdminTableHead>
            <AdminTableHead>Stripe references</AdminTableHead>
            {/* Written by ActionRequiredError or the error serializer. */}
            <AdminTableHead>Reason and resolution</AdminTableHead>
            <AdminTableHead>
              <span className="sr-only">Actions</span>
            </AdminTableHead>
          </tr>
        </AdminTableHeader>
        <AdminTableBody>
          {events.length === 0 && (
            <AdminTableEmpty
              colSpan={6}
              title={status ? "No events in this status" : "No Stripe events"}
              description={
                status ? `There are no events marked “${status}”.` : undefined
              }
            />
          )}
          {events.map((event) => (
            <AdminTableRow key={event.event_id}>
              <AdminTableCell>
                <div className="font-medium">{event.event_type}</div>
                <div className="mt-1 font-mono text-sm text-muted-foreground break-all">
                  {event.event_id}
                </div>
                {/* Test mode in production indicates the wrong signing secret. */}
                {event.livemode === false && (
                  <AdminStatusBadge className="mt-2">
                    Test mode
                  </AdminStatusBadge>
                )}
              </AdminTableCell>
              <AdminTableCell>
                <StatusBadge status={event.status} />
                <div className="mt-2 text-sm text-muted-foreground">
                  {event.attempts} attempt{event.attempts === 1 ? "" : "s"}
                </div>
              </AdminTableCell>
              <AdminTableCell className="whitespace-nowrap text-muted-foreground">
                {formatAdminDate(event.received_at)}
              </AdminTableCell>
              <AdminTableCell>
                <dl className="space-y-2 font-mono text-sm">
                  <div>
                    <dt className="text-muted-foreground">Customer</dt>
                    <dd className="break-all">
                      {event.stripe_customer_id ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Invoice</dt>
                    <dd className="break-all">
                      {event.stripe_invoice_id ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Subscription</dt>
                    <dd className="break-all">
                      {event.stripe_subscription_id ?? "—"}
                    </dd>
                  </div>
                </dl>
              </AdminTableCell>
              <AdminTableCell className="max-w-md whitespace-pre-wrap break-words">
                {event.last_error ?? "—"}
                {event.resolution_note && (
                  <span className="mt-2 block text-sm text-muted-foreground">
                    Resolution: {event.resolution_note}
                  </span>
                )}
              </AdminTableCell>
              <AdminTableCell>
                {RESOLVABLE_STATUSES.includes(
                  event.status as (typeof RESOLVABLE_STATUSES)[number],
                ) && (
                  <ResolveStripeEvent
                    eventId={event.event_id}
                    canWrite={canWrite}
                  />
                )}
              </AdminTableCell>
            </AdminTableRow>
          ))}
        </AdminTableBody>
      </AdminTable>

      <Pager
        page={page}
        pageSize={limit}
        total={filteredTotal}
        unit="events"
        href={(target) =>
          `${href(status ?? "")}${status ? "&" : "?"}page=${target}`
        }
      />
    </div>
  );
}
