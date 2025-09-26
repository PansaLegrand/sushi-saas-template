import { respData, respErr, respNoAuth } from "@/lib/resp";
import {
  CreditsTransType,
  decreaseCredits,
  getUserCreditSummary,
} from "@/services/credit";
import { getUserUuid } from "@/services/user";

interface ConsumeCreditsRequest {
  credits?: number;
}

export async function POST(req: Request) {
  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) {
      return respNoAuth();
    }

    let payload: ConsumeCreditsRequest = {};
    try {
      payload = (await req.json()) as ConsumeCreditsRequest;
    } catch (error) {
      // Empty bodies fall back to defaults so we swallow parse errors.
      payload = {};
    }

    const credits = payload.credits ?? 1;

    if (!Number.isFinite(credits) || credits <= 0) {
      return respErr("credits must be a positive number");
    }

    await decreaseCredits({
      user_uuid: userUuid,
      trans_type: CreditsTransType.MockUsage,
      credits,
    });

    const summary = await getUserCreditSummary(userUuid, {
      includeLedger: false,
      includeExpiring: false,
    });

    return respData({ balance: summary.balance });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "consume credits failed";

    if (message === "insufficient credits") {
      return respErr("insufficient credits");
    }

    console.error("consume credits failed", error);
    return respErr("consume credits failed");
  }
}
