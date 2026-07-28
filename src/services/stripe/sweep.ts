import {
  countStripeWebhookEventsByStatus,
  findStuckStripeWebhookEvents,
  type StripeWebhookEventRow,
} from "@/models/stripe-webhook-event";
import { enqueueJobSafe } from "@/services/jobs";
import { logger } from "@/lib/logger/server";

/**
 * How long a `failed` event may sit before it counts as stuck.
 *
 * Stripe retries a failing endpoint for about three days with widening backoff.
 * Under that, a `failed` row is a delivery that will probably succeed on its own,
 * and alerting on it means alerting on every transient blip. Past it, Stripe has
 * given up and the row will stay `failed` forever with nothing left to retry it.
 *
 * Set to four days rather than three so a genuinely transient failure has run out
 * of retries before anyone is woken up.
 */
const FAILED_STUCK_MS = 4 * 24 * 60 * 60 * 1000;

/** Cap per run: an alert listing 500 events is not an alert anyone reads. */
const SWEEP_LIMIT = 50;

export type StripeSweepResult = {
  /** Events needing a person: `action_required`, plus `failed` past its retries. */
  stuck: number;
  actionRequired: number;
  failedPastRetries: number;
  /** Every status with a row, for the cron log line. */
  byStatus: Record<string, number>;
  alerted: boolean;
};

/**
 * Find webhook events that will not resolve themselves, and say so once an hour.
 *
 * This is the half of step 4 that makes `action_required` worth having. A status
 * nobody looks at is a status that does not exist: an event parked because a price
 * is unmapped sits there silently until a customer complains, which is the same
 * failure mode as the silent `break` it replaced — only one table further along.
 *
 * Deliberately **does not retry anything.** A `failed` row past its retries needs
 * the stored payload replayed through the handler, and a parked one needs a human
 * decision first. Both are real features; neither is "notice the problem", which
 * is what this is.
 */
export async function sweepStripeWebhookEvents(
  now: Date = new Date()
): Promise<StripeSweepResult> {
  const failedBefore = new Date(now.getTime() - FAILED_STUCK_MS);

  const stuck = await findStuckStripeWebhookEvents({
    failedBefore,
    limit: SWEEP_LIMIT,
  });
  const byStatus = await countStripeWebhookEventsByStatus();

  const actionRequired = stuck.filter(
    (row) => row.status === "action_required"
  ).length;
  const failedPastRetries = stuck.length - actionRequired;

  const result: StripeSweepResult = {
    stuck: stuck.length,
    actionRequired,
    failedPastRetries,
    byStatus,
    alerted: false,
  };

  if (stuck.length === 0) {
    return result;
  }

  logger.error(
    {
      event: "stripe.sweep_stuck_events",
      stuck: stuck.length,
      action_required: actionRequired,
      failed_past_retries: failedPastRetries,
      // Enough to go and look, not the whole table.
      sample: stuck.slice(0, 5).map(summarize),
    },
    "stripe webhook events need attention"
  );

  // Bucketed to the hour, so a row that stays stuck is reported once an hour
  // rather than on every five-minute cron tick. Unfixed problems should keep
  // reminding you; they should not train you to ignore the channel.
  const bucket = now.toISOString().slice(0, 13);

  // `alerted` reports whether a message was actually created, which is why
  // `enqueueJob` returns that rather than void: within the same hour the dedupe
  // key suppresses the insert, and a sweep claiming it alerted would be taking
  // credit for a message nobody received. `enqueueJobSafe` so a queueing failure
  // cannot fail the cron run that also drains the queue — the count is logged
  // above regardless, so the information is never lost either way.
  result.alerted = await enqueueJobSafe(
    "slack_error",
    {
      title: `${stuck.length} Stripe webhook event(s) need attention`,
      context: {
        action_required: actionRequired,
        failed_past_retries: failedPastRetries,
        by_status: byStatus,
        sample: stuck.slice(0, 5).map(summarize),
      },
    },
    { dedupeKey: `stripe_sweep:${bucket}` }
  );

  return result;
}

/** The fields an operator needs to find the event in Stripe and act on it. */
function summarize(row: StripeWebhookEventRow) {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    status: row.status,
    attempts: row.attempts,
    // Written by `markStripeWebhookEventActionRequired`: the reason, already
    // formatted for a human by `ActionRequiredError.describe()`.
    reason: row.last_error,
    stripe_customer_id: row.stripe_customer_id,
    stripe_invoice_id: row.stripe_invoice_id,
    stripe_subscription_id: row.stripe_subscription_id,
    updated_at: row.updated_at?.toISOString(),
  };
}
