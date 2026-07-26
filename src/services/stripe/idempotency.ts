/**
 * The deterministic ids that make Stripe fulfillment safe to replay.
 *
 * Stripe delivers a webhook at least once, not exactly once. It retries for
 * days, it can deliver the same event to two instances at the same time, and
 * two *different* events can describe the same money — a
 * `checkout.session.completed` and the `invoice.payment_succeeded` for the same
 * first period, for instance.
 *
 * So every write on a Stripe path derives its primary key from the Stripe
 * object it is recording, never from a fresh id. A replay then collides with
 * the row it would have duplicated, and the database refuses it. That is a
 * guarantee; a preceding `select` that finds nothing is only a guess, because
 * another delivery can insert between the select and the insert.
 *
 * All three formats are prefixed so a human reading the `credits` or `orders`
 * table can tell at a glance why a row exists and what would reproduce it.
 */

/**
 * Ledger key for the credits attached to a single order.
 *
 * One order pays out once, so the order number is the whole key.
 */
export function orderPayTransNo(orderNo: string): string {
  return `order_pay:${orderNo}`;
}

/**
 * Ledger key for a subscription's credits for one billing period.
 *
 * Keyed on the period *start* rather than the invoice id: an invoice can be
 * voided and reissued for the same period, and the customer is owed one grant
 * for that period either way. `sub_id` alone would be wrong in the other
 * direction — it would grant once and never renew.
 */
export function subscriptionPeriodTransNo(
  subId: string,
  periodStart: number
): string {
  return `stripe_period:${subId}:${periodStart}`;
}

/**
 * Order number for a renewal cycle.
 *
 * Deterministic so `orders.order_no` — already unique — makes the renewal
 * insert idempotent with no new index and no migration. The alternative, a
 * unique index on `(sub_id, sub_period_start)`, buys the same protection and
 * costs a schema change.
 */
export function renewalOrderNo(subId: string, periodStart: number): string {
  return `renewal:${subId}:${periodStart}`;
}
