/**
 * A webhook event that cannot be completed and will not fix itself.
 *
 * The webhook already had two outcomes: completed, or failed and retried. Both
 * are wrong for "this price is not in the plan catalog". Retrying for three days
 * will not add it, and completing the event says the work was done when it was
 * not — so the row that should be a work order becomes indistinguishable from a
 * success.
 *
 * Throwing this parks the event as `action_required` and answers Stripe with a
 * 200, which stops the automatic retries. It stays replayable: a deliberate
 * replay from the Stripe dashboard, once a human has fixed the cause, reclaims
 * the row like a failure. What it will not do is retry on its own.
 *
 * Distinct from `AppError` on purpose. `AppError` carries a message for a user
 * and a status for a response; this carries a reason for an operator, and its
 * audience is a person reading a database row during an incident.
 */
export class ActionRequiredError extends Error {
  /**
   * Short, stable, machine-groupable — `unmapped_price`, not a sentence. It is
   * what a reconciliation sweep counts by, so it must not vary with the details.
   */
  readonly reason: string;

  /** The specifics: which price, which customer. Free text, for a human. */
  readonly detail: Record<string, unknown>;

  constructor(reason: string, detail: Record<string, unknown> = {}) {
    super(`action required: ${reason}`);
    this.name = "ActionRequiredError";
    this.reason = reason;
    this.detail = detail;
  }

  /** One line for `last_error`, which is where an operator will read it. */
  describe(): string {
    const pairs = Object.entries(this.detail)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${key}=${String(value)}`);

    return pairs.length ? `${this.reason} (${pairs.join(" ")})` : this.reason;
  }
}

export function isActionRequired(error: unknown): error is ActionRequiredError {
  return error instanceof ActionRequiredError;
}
