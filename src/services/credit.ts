import {
  type CreditRow,
  findCreditByOrderNo,
  findCreditByTransNo,
  getUserValidCredits,
  insertCredit,
  insertSpendCreditIfSufficient,
  listAllCreditsByUserUuid,
} from "@/models/credit";
import { getFirstPaidOrderByUserUuid } from "@/models/order";
import { AppError } from "@/lib/errors/app-error";
import { getSnowId } from "@/lib/hash";
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
  user_uuid: string;
  trans_type: CreditsTransType;
  credits: number;
}

interface IncreaseCreditsParams {
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

export async function getUserCreditSummary(
  userUuid: string,
  options: CreditSummaryOptions = {}
): Promise<CreditSummary> {
  const rows = await listAllCreditsByUserUuid(userUuid);

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

export async function getUserCredits(userUuid: string): Promise<UserCredits> {
  const status: UserCredits = {
    left_credits: 0,
    is_pro: false,
    is_recharged: false,
  };

  try {
    const firstPaidOrder = await getFirstPaidOrderByUserUuid(userUuid);
    if (firstPaidOrder) {
      status.is_recharged = true;
    }

    const credits = await getUserValidCredits(userUuid);
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
    console.error("get user credits failed", error);
  }

  return status;
}

export async function decreaseCredits({
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
      user_uuid,
      trans_type,
      credits,
    });

    if (!created) {
      throw new AppError("CREDITS_INSUFFICIENT", {
        message: `user ${user_uuid} has insufficient credits for ${credits}`,
        details: { required: credits },
      });
    }

    return created.trans_no;
  } catch (error) {
    console.error("decrease credits failed", error);
    throw error;
  }
}

export async function increaseCredits({
  user_uuid,
  trans_type,
  credits,
  expired_at,
  order_no,
  trans_no,
}: IncreaseCreditsParams): Promise<void> {
  if (credits <= 0) {
    throw new Error("credits must be greater than zero");
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
      user_uuid,
      trans_type,
      credits,
      order_no: order_no ?? "",
      expired_at: expiryDate,
    };

    await insertCredit(newCredit);
  } catch (error) {
    console.error("increase credits failed", error);
    throw error;
  }
}

export async function refundCreditsForTransaction({
  user_uuid,
  original_trans_no,
}: RefundCreditsParams): Promise<string> {
  const original = await findCreditByTransNo(original_trans_no);
  if (!original) {
    throw new Error("original credit transaction not found");
  }

  if (original.user_uuid !== user_uuid) {
    throw new Error("credit transaction does not belong to user");
  }

  if (original.credits >= 0) {
    throw new Error("only consumed credits can be refunded");
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
      user_uuid,
      trans_type: CreditsTransType.TaskAdjust,
      credits: Math.abs(original.credits),
      order_no: original.order_no,
      expired_at: original.expired_at,
    });

    if (!created) {
      throw new Error("failed to insert credit refund");
    }

    return created.trans_no;
  } catch (error) {
    const createdByRace = await findCreditByTransNo(refundTransNo);
    if (createdByRace) {
      return createdByRace.trans_no;
    }

    console.error("refund credits failed", error);
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

    await increaseCredits({
      user_uuid: order.user_uuid,
      trans_type: CreditsTransType.OrderPay,
      credits: order.credits,
      expired_at: order.expired_at ?? undefined,
      order_no: order.order_no,
    });
  } catch (error) {
    console.error("update credit for order failed", error);
    throw error;
  }
}
