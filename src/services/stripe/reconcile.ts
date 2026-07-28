import { findLedgerBalanceDrift } from "@/models/credit";
import { findPaidOrdersMissingCredits } from "@/models/fulfillment";
import { findOrderBySubscriptionPeriod } from "@/models/order";
import {
  countStripeWebhookEventsByStatus,
  findStripeWebhookEventsByInvoiceId,
  findStuckStripeWebhookEvents,
} from "@/models/stripe-webhook-event";

/**
 * Reconciliation: does what Stripe thinks happened match what this database
 * recorded?
 *
 * Every guarantee the billing code makes is enforced somewhere — a unique index,
 * a transaction, an advisory lock. This exists because a guarantee nobody audits
 * is a belief, and because the failures that matter most here are the *silent*
 * ones: a wrong-but-successful write throws nothing, alerts nobody, and is
 * indistinguishable from correct behaviour until a customer asks where their
 * credits went.
 *
 * Split into local checks and Stripe checks on purpose. The local half needs no
 * API key, so it runs in CI and on a laptop; the Stripe half is the only part
 * that can catch "Stripe charged them and we never heard about it".
 */

export type ReconcileFindingKind =
  /** A paid order that promised credits and has no ledger row. Item 4's bug. */
  | "order_missing_credits"
  /** `balance_after` disagrees with the ledger. Two writes raced. */
  | "ledger_balance_drift"
  /** An event parked for a human, or failed past Stripe's retries. */
  | "stuck_event"
  /** Stripe says this invoice was paid; no event for it was ever recorded. */
  | "invoice_without_receipt"
  /** The event arrived but no local order exists for the billing period. */
  | "invoice_without_order";

export type ReconcileFinding = {
  kind: ReconcileFindingKind;
  /**
   * Whether this needs a person now, or is a note.
   *
   * `error` means money and entitlement may disagree right now. `warn` means
   * something is worth knowing but has a benign explanation available — an event
   * still mid-retry, say. Only `error` should fail a pipeline, or the check gets
   * switched off.
   */
  severity: "error" | "warn";
  detail: Record<string, unknown>;
};

export type ReconcileReport = {
  since: string;
  checkedInvoices: number;
  eventsByStatus: Record<string, number>;
  findings: ReconcileFinding[];
  /** True when nothing at `error` severity was found. */
  ok: boolean;
};

/** A Stripe invoice, reduced to what reconciliation needs. Keeps the SDK out. */
export type InvoiceSummary = {
  id: string;
  subscription?: string | null;
  period_start?: number | null;
  amount_paid?: number | null;
  customer?: string | null;
};

function finalize(
  since: Date,
  checkedInvoices: number,
  eventsByStatus: Record<string, number>,
  findings: ReconcileFinding[]
): ReconcileReport {
  return {
    since: since.toISOString(),
    checkedInvoices,
    eventsByStatus,
    findings,
    ok: !findings.some((finding) => finding.severity === "error"),
  };
}

/**
 * The half that needs no Stripe API key.
 *
 * Everything here compares this database against itself, which is enough to catch
 * the two defects this kit has actually shipped: a paid order with no credits,
 * and a running balance computed against a stale read.
 */
export async function reconcileLocalBilling(input: {
  since: Date;
  limit?: number;
}): Promise<ReconcileReport> {
  const findings: ReconcileFinding[] = [];

  for (const order of await findPaidOrdersMissingCredits({
    since: input.since,
    limit: input.limit,
  })) {
    findings.push({
      kind: "order_missing_credits",
      // The most serious thing this script can find: the customer paid and the
      // ledger has nothing. Never a warning.
      severity: "error",
      detail: {
        order_no: order.order_no,
        org_uuid: order.org_uuid,
        credits_promised: order.credits,
        paid_at: order.paid_at?.toISOString(),
      },
    });
  }

  for (const row of await findLedgerBalanceDrift(input.limit ?? 100)) {
    findings.push({
      kind: "ledger_balance_drift",
      severity: "error",
      detail: {
        credit_id: row.id,
        trans_no: row.trans_no,
        org_uuid: row.org_uuid,
        balance_after: row.balance_after,
        expected_balance_after: row.expected_balance_after,
      },
    });
  }

  // Stuck events are `warn`: the row is already recorded, the cron sweep already
  // alerts on it, and a human is already the intended reader. Failing a pipeline
  // on one would mean an unmapped price blocks every deploy until someone maps
  // it — which is pressure applied to the wrong person at the wrong moment.
  for (const event of await findStuckStripeWebhookEvents({
    failedBefore: new Date(input.since.getTime()),
    limit: input.limit ?? 50,
  })) {
    findings.push({
      kind: "stuck_event",
      severity: "warn",
      detail: {
        event_id: event.event_id,
        event_type: event.event_type,
        status: event.status,
        reason: event.last_error,
        stripe_invoice_id: event.stripe_invoice_id,
        stripe_subscription_id: event.stripe_subscription_id,
      },
    });
  }

  return finalize(
    input.since,
    0,
    await countStripeWebhookEventsByStatus(),
    findings
  );
}

/**
 * Check a batch of paid Stripe invoices against local state.
 *
 * Takes plain summaries rather than reaching for Stripe itself, so the comparison
 * is testable without a network and the caller owns pagination. The script is
 * what walks Stripe.
 */
export async function reconcileStripeInvoices(input: {
  since: Date;
  invoices: InvoiceSummary[];
  limit?: number;
}): Promise<ReconcileReport> {
  const local = await reconcileLocalBilling({
    since: input.since,
    limit: input.limit,
  });
  const findings = [...local.findings];

  for (const invoice of input.invoices) {
    const events = await findStripeWebhookEventsByInvoiceId(invoice.id);

    if (events.length === 0) {
      findings.push({
        kind: "invoice_without_receipt",
        // Stripe took the money and this deployment has no record of being told.
        // Either the endpoint was misconfigured or the delivery was lost.
        severity: "error",
        detail: {
          stripe_invoice_id: invoice.id,
          stripe_customer_id: invoice.customer,
          amount_paid: invoice.amount_paid,
        },
      });
      continue;
    }

    // Without a subscription and a period there is no deterministic order number
    // to look for. A one-off invoice is not a renewal, so this is not a defect.
    if (!invoice.subscription || !invoice.period_start) continue;

    const order = await findOrderBySubscriptionPeriod(
      invoice.subscription,
      invoice.period_start
    );

    if (!order) {
      // An event was recorded but no order exists. If that event is parked or
      // failed, the stuck-event finding above already explains why, and this
      // would be the same problem counted twice at a higher severity.
      const explained = events.some(
        (event) => event.status === "action_required" || event.status === "failed"
      );

      findings.push({
        kind: "invoice_without_order",
        severity: explained ? "warn" : "error",
        detail: {
          stripe_invoice_id: invoice.id,
          stripe_subscription_id: invoice.subscription,
          period_start: invoice.period_start,
          event_statuses: events.map((event) => event.status),
          explained_by_stuck_event: explained,
        },
      });
    }
  }

  return finalize(
    input.since,
    input.invoices.length,
    local.eventsByStatus,
    findings
  );
}
