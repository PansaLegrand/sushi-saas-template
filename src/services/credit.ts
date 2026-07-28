import {
  type CreditActor,
  type CreditRow,
  findCreditByTransNo,
  getOrgValidCredits,
  insertCredit,
  insertSpendCreditIfSufficient,
  listAllCreditsByOrg,
} from "@/models/credit";
import { getFirstPaidOrderByOrg } from "@/models/order";
import { AppError } from "@/lib/errors/app-error";
import { newId } from "@/lib/ids";
import { logger } from "@/lib/logger/server";
import { getIsoTimestr } from "@/lib/time";
import type { CreditLedgerEntry, CreditSummary } from "@/types/credit";
import type { UserCredits } from "@/types/user";

const DEFAULT_LEDGER_LIMIT = 50;
const EXPIRING_WINDOW_DAYS = 14;

export enum CreditsTransType {
  NewUser = "new_user",
  OrderPay = "order_pay",
  SystemAdd = "system_add",
  Ping = "ping",
  MockUsage = "mock_usage",
  TaskTextToVideo = "task_text_to_video",
  TaskAdjust = "task_adjust",
}

export enum CreditsAmount {
  NewUserGet = 10,
  PingCost = 1,
}

interface CreditSummaryOptions {
  ledgerLimit?: number;
  includeLedger?: boolean;
  includeExpiring?: boolean;
}

/**
 * Context every write carries, so a row can answer "who did this, and why".
 *
 * `actor` is required, never defaulted. A default would be applied by the one
 * call site that forgot to think about it, which is exactly the site whose
 * provenance later turns out to matter.
 */
interface CreditAuditParams {
  actor: CreditActor;
  /**
   * JSON-serializable context stored on the row: the task a spend paid for, the
   * transaction a refund reverses. Serialized here so callers pass objects and
   * the column stays the only place that knows it is text.
   */
  metadata?: Record<string, unknown> | null;
}

interface DecreaseCreditsParams extends CreditAuditParams {
  /** Whose balance moves. */
  org_uuid: string;
  /** Which member spent it. Recorded for attribution, never summed. */
  user_uuid: string;
  trans_type: CreditsTransType;
  credits: number;
}

interface IncreaseCreditsParams extends CreditAuditParams {
  org_uuid: string;
  user_uuid: string;
  trans_type: CreditsTransType | string;
  credits: number;
  expired_at?: string | Date | null;
  order_no?: string;
  /**
   * Explicit ledger transaction number. Pass a deterministic value to make a
   * grant idempotent: `trans_no` is unique, so a replay fails the insert
   * instead of double-crediting. Defaults to a fresh id.
   */
  trans_no?: string;
}

interface RefundCreditsParams {
  org_uuid: string;
  user_uuid: string;
  original_trans_no: string;
  /** Defaults to `system:credit_refund` — a refund is us, acting on our own. */
  actor?: CreditActor;
}

function serializeMetadata(
  metadata?: Record<string, unknown> | null
): string | null {
  if (!metadata) return null;
  return JSON.stringify(metadata);
}

function toIsoString(value?: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function buildLedgerEntry(row: CreditRow): CreditLedgerEntry {
  return {
    transNo: row.trans_no,
    transType: row.trans_type,
    credits: row.credits,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    orderNo: row.order_no,
    expiredAt: toIsoString(row.expired_at),
  };
}

function isExpiredGrant(row: CreditRow, now: Date): boolean {
  return (
    row.credits > 0 &&
    !!row.expired_at &&
    row.expired_at.getTime() <= now.getTime()
  );
}

function willExpireSoon(row: CreditRow, now: Date): boolean {
  if (row.credits <= 0 || !row.expired_at) {
    return false;
  }

  const diffMs = row.expired_at.getTime() - now.getTime();
  const windowMs = EXPIRING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  return diffMs > 0 && diffMs <= windowMs;
}

export async function getOrgCreditSummary(
  orgUuid: string,
  options: CreditSummaryOptions = {}
): Promise<CreditSummary> {
  const rows = await listAllCreditsByOrg(orgUuid);

  const now = new Date();
  const summary: CreditSummary = {
    balance: 0,
    granted: 0,
    consumed: 0,
    expired: 0,
    expiringSoon: [],
    ledger: [],
  };

  const ledgerLimit = Math.max(options.ledgerLimit ?? DEFAULT_LEDGER_LIMIT, 1);
  const includeLedger = options.includeLedger ?? true;
  const includeExpiring = options.includeExpiring ?? true;

  let ledgerCount = 0;

  for (const row of rows) {
    const expiredGrant = isExpiredGrant(row, now);

    if (row.credits > 0) {
      if (expiredGrant) {
        summary.expired += row.credits;
      } else {
        summary.balance += row.credits;
        summary.granted += row.credits;
      }
    } else if (row.credits < 0) {
      // Negative credits capture consumption so we always subtract them.
      summary.balance += row.credits;
      summary.consumed += Math.abs(row.credits);
    }

    if (includeExpiring && willExpireSoon(row, now) && !expiredGrant) {
      summary.expiringSoon.push(buildLedgerEntry(row));
    }

    if (includeLedger && ledgerCount < ledgerLimit) {
      summary.ledger.push(buildLedgerEntry(row));
      ledgerCount += 1;
    }
  }

  return summary;
}

export async function getOrgCredits(orgUuid: string): Promise<UserCredits> {
  const status: UserCredits = {
    left_credits: 0,
    is_pro: false,
    is_recharged: false,
  };

  try {
    const firstPaidOrder = await getFirstPaidOrderByOrg(orgUuid);
    if (firstPaidOrder) {
      status.is_recharged = true;
    }

    const credits = await getOrgValidCredits(orgUuid);
    if (credits?.length) {
      for (const entry of credits) {
        status.left_credits += entry.credits || 0;
      }
    }

    if (status.left_credits < 0) {
      status.left_credits = 0;
    }

    if (status.left_credits > 0) {
      status.is_pro = true;
    }
  } catch (error) {
    logger.error({ err: error, org_uuid: orgUuid }, "get org credits failed");
  }

  return status;
}

export async function decreaseCredits({
  org_uuid,
  user_uuid,
  trans_type,
  credits,
  actor,
  metadata,
}: DecreaseCreditsParams): Promise<string> {
  if (credits <= 0) {
    throw new AppError("CREDITS_INVALID_AMOUNT", {
      message: `credits must be greater than zero: ${credits}`,
    });
  }

  try {
    const created = await insertSpendCreditIfSufficient({
      trans_no: newId(),
      created_at: new Date(getIsoTimestr()),
      org_uuid,
      user_uuid,
      trans_type,
      credits,
      actor,
      metadata_json: serializeMetadata(metadata),
    });

    if (!created) {
      throw new AppError("CREDITS_INSUFFICIENT", {
        message: `org ${org_uuid} has insufficient credits for ${credits}`,
        details: { required: credits },
      });
    }

    return created.trans_no;
  } catch (error) {
    logger.error(
      { err: error, org_uuid, user_uuid, trans_type, credits },
      "decrease credits failed"
    );
    throw error;
  }
}

export async function increaseCredits({
  org_uuid,
  user_uuid,
  trans_type,
  credits,
  expired_at,
  order_no,
  trans_no,
  actor,
  metadata,
}: IncreaseCreditsParams): Promise<void> {
  if (credits <= 0) {
    throw new AppError("CREDITS_INVALID_AMOUNT", {
      message: `credits must be greater than zero: ${credits}`,
    });
  }

  try {
    const expiryDate =
      expired_at instanceof Date
        ? expired_at
        : expired_at
        ? new Date(expired_at)
        : null;

    const newCredit: Parameters<typeof insertCredit>[0] = {
      trans_no: trans_no ?? newId(),
      created_at: new Date(getIsoTimestr()),
      org_uuid,
      user_uuid,
      trans_type,
      credits,
      order_no: order_no ?? "",
      expired_at: expiryDate,
      actor,
      metadata_json: serializeMetadata(metadata),
    };

    await insertCredit(newCredit);
  } catch (error) {
    logger.error(
      { err: error, org_uuid, user_uuid, trans_type, credits, order_no },
      "increase credits failed"
    );
    throw error;
  }
}

export async function refundCreditsForTransaction({
  org_uuid,
  user_uuid,
  original_trans_no,
  actor = "system:credit_refund",
}: RefundCreditsParams): Promise<string> {
  const original = await findCreditByTransNo(original_trans_no);
  if (!original) {
    throw new AppError("CREDITS_TRANSACTION_NOT_FOUND", {
      message: `original credit transaction not found: ${original_trans_no}`,
    });
  }

  // The tenancy check. `findCreditByTransNo` is unscoped by necessity — a
  // trans_no is globally unique and the caller holds only that — so this is
  // where the row is proven to belong to the caller's organization. Reported as
  // "not found" rather than "forbidden": whether a transaction exists in
  // another tenant is not something this caller gets to learn.
  if (original.org_uuid !== org_uuid) {
    throw new AppError("CREDITS_TRANSACTION_NOT_FOUND", {
      message: `credit transaction ${original_trans_no} does not belong to org ${org_uuid}`,
    });
  }

  if (original.credits >= 0) {
    throw new AppError("CREDITS_INVALID_AMOUNT", {
      message: `only consumed credits can be refunded: ${original_trans_no}`,
    });
  }

  const refundTransNo = `refund_${original_trans_no}`;
  const existing = await findCreditByTransNo(refundTransNo);
  if (existing) {
    return existing.trans_no;
  }

  try {
    const created = await insertCredit({
      trans_no: refundTransNo,
      created_at: new Date(getIsoTimestr()),
      org_uuid,
      user_uuid,
      trans_type: CreditsTransType.TaskAdjust,
      credits: Math.abs(original.credits),
      order_no: original.order_no,
      expired_at: original.expired_at,
      actor,
      // The reversed transaction. Also encoded in `trans_no` for idempotency,
      // recorded here so reading the row does not require parsing its key.
      metadata_json: serializeMetadata({
        reverses_trans_no: original_trans_no,
        reverses_trans_type: original.trans_type,
      }),
    });

    if (!created) {
      throw new AppError("CREDITS_GRANT_FAILED", {
        message: `failed to insert credit refund for ${original_trans_no}`,
      });
    }

    return created.trans_no;
  } catch (error) {
    const createdByRace = await findCreditByTransNo(refundTransNo);
    if (createdByRace) {
      return createdByRace.trans_no;
    }

    logger.error(
      { err: error, original_trans_no, refund_trans_no: refundTransNo },
      "refund credits failed"
    );
    throw error;
  }
}

/**
 * Order fulfillment used to live here, as a `findCreditByOrderNo` check
 * followed by a grant. It was never called by anything, while the live Stripe
 * path used a *different* and incorrect guard — two versions of the same rule
 * in one repo, one right and unreachable.
 *
 * It now lives in `src/models/fulfillment.ts`, where the status write and the
 * grant share a transaction, and the grant carries a deterministic `trans_no`
 * so the database refuses a replay instead of a `select` hoping to spot one.
 */
