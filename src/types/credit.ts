export interface CreditLedgerEntry {
  /**
   * The logical root transaction for customer views. Admin audit views expose
   * each immutable physical FEFO part under its own transaction number.
   */
  transNo: string;
  transType: string;
  credits: number;
  createdAt: string;
  orderNo?: string | null;
  expiredAt?: string | null;
  /**
   * The organization's running total after this row, or null for rows written
   * before migration 0018.
   *
   * Sent to everyone, including the account page: it is the org's own balance,
   * and a ledger you cannot check the arithmetic of is a ledger you have to
   * trust. Note it counts expired grants, so it will not match the spendable
   * `balance` above — see the schema comment on `credits.balance_after`.
   */
  balanceAfter?: number | null;
  /**
   * Who caused the movement, and any internal context. **Admin-only** — present
   * only when the caller passes `includeAudit`.
   *
   * Withheld from customer-facing responses on purpose: `actor` can be
   * `admin:<uuid>`, and `metadata` carries Stripe event ids and idempotency
   * keys. None of that is a customer's business, and none of it helps them.
   */
  actor?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreditSummary {
  /** Credits that can be spent now, after FEFO allocation and expiration. */
  balance: number;
  /** Face value of positive ledger rows whose expiration has not passed. */
  granted: number;
  /** Portion of active grants already consumed. */
  consumed: number;
  /** Unused credits that reached expiration. */
  expired: number;
  /** Remaining amounts in grant buckets expiring within the warning window. */
  expiringSoon: CreditLedgerEntry[];
  ledger: CreditLedgerEntry[];
}
