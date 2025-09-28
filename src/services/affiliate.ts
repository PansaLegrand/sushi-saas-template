import { findAffiliateByOrderNo, insertAffiliate } from "@/models/affiliate";
import { findUserByUuid } from "@/models/user";
import type { Order } from "@/types/order";
import {
  AffiliateConfig,
  AffiliateRewardAmount,
  AffiliateRewardPercent,
  AffiliateStatus,
  CommissionMode,
} from "@/data/affiliate";
import { getIsoTimestr } from "@/lib/time";

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

export async function updateAffiliateForOrder(order: Order) {
  if (!AffiliateConfig.enabled) return;

  try {
    const user = await findUserByUuid(order.user_uuid);
    if (!user || !user.uuid) return;

    // Ignore if no referrer or self-referral
    if (!user.invited_by || (!AffiliateConfig.allowSelfReferral && user.invited_by === user.uuid)) {
      return;
    }

    const existing = await findAffiliateByOrderNo(order.order_no);
    if (existing) return;

    // Widen commission mode in case config is compiled as a literal
    const { rewardAmount, rewardPercent } = computeReward(order.amount);

    await insertAffiliate({
      user_uuid: user.uuid,
      invited_by: user.invited_by,
      created_at: new Date(getIsoTimestr()),
      status: AffiliateStatus.Completed,
      paid_order_no: order.order_no,
      paid_amount: order.amount,
      reward_percent: rewardPercent,
      reward_amount: rewardAmount,
    });
  } catch (e) {
    console.log("update affiliate for order failed: ", e);
    throw e;
  }
}
