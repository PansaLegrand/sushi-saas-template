import Link from "next/link";

import { getAdminContext } from "@admin/lib/authz";
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
  const tone =
    status === "action_required"
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : status === "failed"
        ? "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400"
        : status === "completed" || status === "resolved"
          ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400"
          : "bg-muted text-muted-foreground border-border";

  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs ${tone}`}>
      {status}
    </span>
  );
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
    <div className="space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stripe Events</h1>
          <p className="text-sm text-muted-foreground">
            Every webhook delivery this deployment recorded. Read-only.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">Total: {total}</p>
      </header>

      {needsAction > 0 && (
        <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <p>
            <strong>{needsAction}</strong> event
            {needsAction === 1 ? "" : "s"} need a decision. These do not retry on
            their own — Stripe was answered 200 so the automatic retries stopped.
          </p>
          {/* The two exits, and they are not interchangeable. Replay re-runs the
              work; Resolve records that a person did it elsewhere. Saying which
              is which here is the difference between an operator clearing the
              queue and an operator clearing the evidence. */}
          <p className="text-xs">
            <strong>To re-run one:</strong> fix the cause, then press Resend in
            the Stripe dashboard. The redelivery reclaims the row and processes
            it against Stripe&apos;s current state — every write on that path is
            keyed on the Stripe object, so a replay cannot double-charge or
            double-credit.{" "}
            <strong>If you handled it outside this system</strong> — refunded by
            hand, accepted a dispute — use Resolve to close it with a note.
            Resolving is final: later redeliveries are acknowledged and not
            re-run.
          </p>
        </div>
      )}

      <nav className="flex flex-wrap gap-2 text-sm">
        {STATUS_FILTERS.map((filter) => {
          const active = (status ?? "") === filter.value;
          const count = filter.value ? (byStatus[filter.value] ?? 0) : total;

          return (
            <Link
              key={filter.value || "all"}
              href={href(filter.value)}
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

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 pl-3 pr-4">Received</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Tries</th>
              {/* Written by `ActionRequiredError.describe()` for a parked event,
                  and by the error serializer for a failed one. */}
              <th className="py-2 pr-4">Reason</th>
              <th className="py-2 pr-4">Customer</th>
              <th className="py-2 pr-4">Invoice</th>
              <th className="py-2 pr-4">Subscription</th>
              <th className="py-2 pr-4">Event</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr className="border-t">
                <td className="p-3 text-muted-foreground" colSpan={10}>
                  No events{status ? ` with status "${status}"` : ""}.
                </td>
              </tr>
            )}
            {events.map((event) => (
              <tr key={event.event_id} className="border-t align-top">
                <td className="py-2 pl-3 pr-4 font-mono text-xs">
                  {event.received_at?.toISOString() ?? "—"}
                </td>
                <td className="py-2 pr-4">
                  {event.event_type}
                  {/* A test-mode event reaching a production console is worth
                      seeing at a glance; the webhook rejects them there, so one
                      showing up means the wrong signing secret is configured. */}
                  {event.livemode === false && (
                    <span className="ml-2 rounded border border-border px-1 text-[10px] text-muted-foreground">
                      test
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  <StatusBadge status={event.status} />
                </td>
                <td className="py-2 pr-4">{event.attempts}</td>
                <td className="py-2 pr-4 max-w-xs whitespace-pre-wrap break-words text-xs">
                  {event.last_error ?? "—"}
                  {event.resolution_note && (
                    <span className="mt-1 block text-muted-foreground">
                      Resolved: {event.resolution_note}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {event.stripe_customer_id ?? "—"}
                </td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {event.stripe_invoice_id ?? "—"}
                </td>
                <td className="py-2 pr-4 font-mono text-xs">
                  {event.stripe_subscription_id ?? "—"}
                </td>
                <td className="py-2 pr-4 font-mono text-[10px]">
                  {event.event_id}
                </td>
                <td className="py-2 pr-4">
                  {RESOLVABLE_STATUSES.includes(
                    event.status as (typeof RESOLVABLE_STATUSES)[number]
                  ) && (
                    <ResolveStripeEvent
                      eventId={event.event_id}
                      canWrite={canWrite}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
