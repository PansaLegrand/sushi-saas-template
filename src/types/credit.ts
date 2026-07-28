export interface CreditLedgerEntry {
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
  balance: number;
  granted: number;
  consumed: number;
  expired: number;
  expiringSoon: CreditLedgerEntry[];
  ledger: CreditLedgerEntry[];
}
