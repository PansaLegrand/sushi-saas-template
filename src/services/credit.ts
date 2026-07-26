import {
  type CreditRow,
  findCreditByOrderNo,
  findCreditByTransNo,
  getOrgValidCredits,
  insertCredit,
  insertSpendCreditIfSufficient,
  listAllCreditsByOrg,
} from "@/models/credit";
import { getFirstPaidOrderByOrg } from "@/models/order";
import { AppError } from "@/lib/errors/app-error";
import { getSnowId } from "@/lib/hash";
import { logger } from "@/lib/logger/server";
import { getIsoTimestr } from "@/lib/time";
import type { Order } from "@/types/order";
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

interface DecreaseCreditsParams {
  /** Whose balance moves. */
  org_uuid: string;
  /** Which member spent it. Recorded for attribution, never summed. */
  user_uuid: string;
  trans_type: CreditsTransType;
  credits: number;
}

interface IncreaseCreditsParams {
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
}: DecreaseCreditsParams): Promise<string> {
  if (credits <= 0) {
    throw new AppError("CREDITS_INVALID_AMOUNT", {
      message: `credits must be greater than zero: ${credits}`,
    });
  }

  try {
    const created = await insertSpendCreditIfSufficient({
      trans_no: getSnowId(),
      created_at: new Date(getIsoTimestr()),
      org_uuid,
      user_uuid,
      trans_type,
      credits,
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
      trans_no: trans_no ?? getSnowId(),
      created_at: new Date(getIsoTimestr()),
      org_uuid,
      user_uuid,
      trans_type,
      credits,
      order_no: order_no ?? "",
      expired_at: expiryDate,
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

export async function updateCreditForOrder(order: Order): Promise<void> {
  try {
    const credit = await findCreditByOrderNo(order.order_no);
    if (credit) {
      // Order already increased credit; no further action required.
      return;
    }

    if (!order.org_uuid) {
      // An order with no tenant cannot be credited to a balance. Throwing keeps
      // the payment reconcilable by hand instead of silently granting nothing.
      throw new AppError("CREDITS_INVALID_AMOUNT", {
        message: `order ${order.order_no} has no organization to credit`,
      });
    }

    await increaseCredits({
      org_uuid: order.org_uuid,
      user_uuid: order.user_uuid,
      trans_type: CreditsTransType.OrderPay,
      credits: order.credits,
      expired_at: order.expired_at ?? undefined,
      order_no: order.order_no,
    });
  } catch (error) {
    logger.error(
      { err: error, order_no: order.order_no, org_uuid: order.org_uuid },
      "update credit for order failed"
    );
    throw error;
  }
}
