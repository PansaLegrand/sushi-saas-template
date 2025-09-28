import { cookies } from "next/headers";
import { respOk, respNoAuth } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { findUserByUuid, updateUserInvitedBy } from "@/models/user";
import { insertAffiliate } from "@/models/affiliate";
import { AffiliateConfig, AffiliateRewardAmount, AffiliateRewardPercent, AffiliateStatus } from "@/data/affiliate";
import { getIsoTimestr } from "@/lib/time";

export async function POST(req: Request) {
  const userUuid = await getUserUuid(req);
  if (!userUuid) {
    return respNoAuth();
  }

  try {
    const c = await cookies();
    const ref = c.get(AffiliateConfig.cookieName)?.value || "";

    const user = await findUserByUuid(userUuid);
    if (!user) {
      return respOk(); // nothing to do
    }

    if (!ref || ref === "") {
      return respOk();
    }

    if (!AffiliateConfig.allowSelfReferral && ref === user.uuid) {
      return respOk();
    }

    if (!user.invited_by) {
      await updateUserInvitedBy(user.uuid, ref);

      // Optionally record a signup affiliate row (defaults to 0 reward)
      await insertAffiliate({
        user_uuid: user.uuid,
        invited_by: ref,
        created_at: new Date(getIsoTimestr()),
        status: AffiliateStatus.Pending,
        paid_order_no: "",
        paid_amount: 0,
        reward_percent: AffiliateRewardPercent.Invited,
        reward_amount: AffiliateRewardAmount.Invited,
      });
    }

    return respOk();
  } catch (e) {
    // Do not leak errors; attribution is best-effort.
    return respOk();
  }
}
