import type { ErrorCode } from "./catalog";
import { isClientApiError } from "./client";

/**
 * The seam between "the server refused" and "here is what to do about it".
 *
 * Three catalog codes mean the same thing to a user — *you cannot do this until
 * you pay for something* — and differ only in what they should be offered. This
 * module is the one place that knows which codes those are, so a page's catch
 * block never grows its own list. Add a fourth code here and every surface that
 * uses `useBillingPrompt` picks it up.
 *
 * It reads `details` off the wire and nothing else. The numbers and the tier
 * name are the only fields the server marks user-safe (see the comment on
 * `requireEntitlement`), and they are re-validated here rather than trusted:
 * `details` survives a proxy, a stale client, and a route that has not been
 * migrated yet, so "a number" is a claim, not a guarantee. A malformed payload
 * degrades to generic copy instead of rendering `NaN credits`.
 */

export type BillingBlockKind = "credits" | "feature" | "limit";

export type BillingBlock = {
  kind: BillingBlockKind;
  code: ErrorCode;
  /** Credits the action costs. */
  required?: number;
  /** Credits the organization actually has. */
  available?: number;
  /** How many are missing. Derived when the server sends both sides. */
  shortfall?: number;
  /**
   * The cheapest tier that would lift the block, when one exists.
   *
   * A plain string, deliberately: comparing it to a tier literal is what
   * `tests/unit/architecture.test.ts` forbids, and this file has no business
   * knowing the catalog. It is a label to render and a signal that upgrading
   * is the remedy — nothing branches on *which* tier it is.
   */
  requiredTier?: string;
};

const KIND_BY_CODE: Partial<Record<ErrorCode, BillingBlockKind>> = {
  CREDITS_INSUFFICIENT: "credits",
  PLAN_UPGRADE_REQUIRED: "feature",
  PLAN_LIMIT_EXCEEDED: "limit",
};

/** A count is only usable if it is a real, non-negative, finite number. */
function readCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * A tier label, length-capped.
 *
 * The cap is not paranoia about our own server: `details` is echoed into a
 * dialog, and the one field here that is a free-form string should not be able
 * to become a wall of text in the middle of someone's checkout decision.
 */
function readTier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 32 ? trimmed : undefined;
}

/**
 * Classify a caught error as a billing block, or return null.
 *
 * Null is the common case and means "not my problem" — the caller falls through
 * to its own error handling. Only a `ClientApiError` qualifies, so a network
 * failure or a bug in a click handler can never open an upsell dialog.
 *
 *     const block = describeBillingBlock(error);
 *     if (block) return openDialog(block);
 *     setMessage(resolveErrorMessage(error, locale));
 */
export function describeBillingBlock(error: unknown): BillingBlock | null {
  if (!isClientApiError(error)) return null;

  const kind = KIND_BY_CODE[error.code];
  if (!kind) return null;

  const details = (error.details ?? {}) as Record<string, unknown>;

  const required = readCount(details.required);
  const available = readCount(details.available);
  const sent = readCount(details.shortfall);

  const block: BillingBlock = { kind, code: error.code };

  if (required !== undefined) block.required = required;
  if (available !== undefined) block.available = available;

  const shortfall =
    sent ?? (required !== undefined && available !== undefined
      ? Math.max(required - available, 0)
      : undefined);
  if (shortfall !== undefined) block.shortfall = shortfall;

  const tier = readTier(details.requiredTier);
  if (tier !== undefined) block.requiredTier = tier;

  return block;
}

/** True when `error` is something the billing prompt can act on. */
export function isBillingBlock(error: unknown): boolean {
  return describeBillingBlock(error) !== null;
}
