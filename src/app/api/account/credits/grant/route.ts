import { respData, respErr, respNoAuth } from "@/lib/resp";
import {
  CreditsTransType,
  increaseCredits,
  getUserCreditSummary,
} from "@/services/credit";
import { getUserUuid } from "@/services/user";
import type { CreditGrantRequest } from "@/types/api";

export async function POST(req: Request) {
  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) {
      return respNoAuth();
    }

    let payload: CreditGrantRequest = { credits: 0 };

    try {
      payload = (await req.json()) as CreditGrantRequest;
    } catch (error) {
      return respErr("invalid params");
    }

    const credits = Number(payload.credits);

    if (!Number.isFinite(credits) || credits <= 0) {
      return respErr("credits must be a positive number");
    }

    await increaseCredits({
      user_uuid: userUuid,
      trans_type: CreditsTransType.SystemAdd,
      credits,
      expired_at: payload.expiredAt,
      order_no: payload.orderNo,
    });

    const summary = await getUserCreditSummary(userUuid, {
      includeLedger: true,
      ledgerLimit: payload.ledgerLimit,
    });

    return respData(summary);
  } catch (error) {
    console.error("grant credits failed", error);
    return respErr("grant credits failed", { status: 500 });
  }
}
