import { isCreditsPlaygroundEnabled } from "@/lib/demo-flags";
import { requireSameOrigin } from "@/lib/origin";
import { respData, respErr, respNoAuth, respNotFound } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { rateLimitOrThrow } from "@/lib/rate-limit";
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
  if (!isCreditsPlaygroundEnabled()) {
    return respNotFound("not found");
  }

  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "credits");
  if (limited) return limited;

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
    return respError(error, {
      logFields: { event: "credits.consume_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
