import {
  cancelPendingAffiliateByOrderNo,
  insertPaidAffiliateOnce,
  insertSignupAffiliateOnce,
} from "@/models/affiliate";
import {
  findUserByInviteCode,
  findUserByUuid,
  updateUserInviteCode,
  updateUserInvitedBy,
} from "@/models/user";
import {
  AffiliateConfig,
  AffiliateRewardAmount,
  AffiliateRewardPercent,
  AffiliateStatus,
  CommissionMode,
} from "@/config/affiliate";
import { getIsoTimestr } from "@/lib/time";
import { newId, newShortCode } from "@/lib/ids";
import { logger } from "@/lib/logger/server";

function computeReward(amountMinor: number): {
  rewardAmount: number;
  rewardPercent: number;
} {
  const fixed = AffiliateConfig.paid.fixed ?? AffiliateRewardAmount.Paid;
  const percent = AffiliateConfig.paid.percent ?? AffiliateRewardPercent.Paid;

  const percentValue = Math.floor((amountMinor * percent) / 100);

  const mode: CommissionMode = AffiliateConfig.commissionMode as CommissionMode;
  switch (mode) {
    case CommissionMode.FixedOnly:
      return { rewardAmount: fixed, rewardPercent: 0 };
    case CommissionMode.PercentOnly:
      return { rewardAmount: percentValue, rewardPercent: percent };
    case CommissionMode.Sum:
      return { rewardAmount: fixed + percentValue, rewardPercent: percent };
    case CommissionMode.GreaterOf:
    default: {
      const rewardAmount = Math.max(fixed, percentValue);
      // If percent contributed, record percent; otherwise 0
      const rewardPercent = rewardAmount === percentValue ? percent : 0;
      return { rewardAmount, rewardPercent };
    }
  }
}

/**
 * Persist first-touch referral attribution.
 *
 * The conditional user update owns the race for the source of truth, and the
 * partial affiliate index makes the derived signup row repairable/idempotent.
 */
export async function applyAffiliateAttribution(input: {
  userUuid: string;
  referrerUuid: string;
}): Promise<void> {
  if (!AffiliateConfig.enabled || !input.referrerUuid) return;

  const user = await findUserByUuid(input.userUuid);
  if (!user) return;

  if (!AffiliateConfig.allowSelfReferral && input.referrerUuid === user.uuid) {
    return;
  }

  let attributedTo = user.invited_by;
  if (!attributedTo) {
    const claimed = await updateUserInvitedBy(user.uuid, input.referrerUuid);
    attributedTo =
      claimed?.invited_by ??
      (await findUserByUuid(user.uuid))?.invited_by ??
      "";
  }

  // Another tab may have won with a different first touch.
  if (attributedTo !== input.referrerUuid) return;

  await insertSignupAffiliateOnce({
    user_uuid: user.uuid,
    invited_by: attributedTo,
    created_at: new Date(getIsoTimestr()),
    status: AffiliateStatus.Pending,
    paid_order_no: "",
    paid_amount: 0,
    reward_percent: AffiliateRewardPercent.Invited,
    reward_amount: AffiliateRewardAmount.Invited,
  });
}

export async function updateAffiliateForOrder(order: {
  order_no: string;
  user_uuid: string;
  amount: number;
}) {
  if (!AffiliateConfig.enabled) return;

  try {
    const user = await findUserByUuid(order.user_uuid);
    if (!user || !user.uuid) return;

    // Ignore if no referrer or self-referral
    if (
      !user.invited_by ||
      (!AffiliateConfig.allowSelfReferral && user.invited_by === user.uuid)
    ) {
      return;
    }

    // Widen commission mode in case config is compiled as a literal
    const { rewardAmount, rewardPercent } = computeReward(order.amount);

    // The database constraint, rather than the lookup above it, is the
    // concurrency boundary. Two webhook workers can reach this line together;
    // one insert wins and the other becomes a harmless no-op.
    await insertPaidAffiliateOnce({
      user_uuid: user.uuid,
      invited_by: user.invited_by,
      created_at: new Date(getIsoTimestr()),
      // Earning and paying are deliberately different states. This starter
      // records the commission for review; adopters connect their own payout
      // rail and mark it completed only after money actually moves.
      status: AffiliateStatus.Pending,
      paid_order_no: order.order_no,
      paid_amount: order.amount,
      reward_percent: rewardPercent,
      reward_amount: rewardAmount,
    });
  } catch (e) {
    logger.error(
      { err: e, order_no: order.order_no, user_uuid: order.user_uuid },
      "update affiliate for order failed",
    );
    throw e;
  }
}

export async function cancelAffiliateRewardForOrder(
  orderNo: string,
): Promise<void> {
  if (!AffiliateConfig.enabled || !orderNo) return;
  await cancelPendingAffiliateByOrderNo(orderNo, AffiliateStatus.Canceled);
}

async function generateUniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newShortCode(8);
    if (!(await findUserByInviteCode(code))) return code;
  }

  return `ref-${newId()}`;
}

export async function getAffiliateInviteCode(
  userUuid: string,
): Promise<string | undefined> {
  if (!AffiliateConfig.enabled) return undefined;
  return (await findUserByUuid(userUuid))?.invite_code || undefined;
}

export async function ensureAffiliateInviteCode(input: {
  userUuid: string;
  regenerate?: boolean;
}): Promise<string | undefined> {
  if (!AffiliateConfig.enabled) return undefined;

  const user = await findUserByUuid(input.userUuid);
  if (!user) return undefined;
  if (!input.regenerate && user.invite_code) return user.invite_code;

  const code = await generateUniqueInviteCode();
  return (await updateUserInviteCode(user.uuid, code))?.invite_code ?? code;
}
