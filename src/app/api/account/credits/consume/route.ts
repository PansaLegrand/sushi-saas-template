import { z } from "zod";

import { isCreditsPlaygroundEnabled } from "@/lib/demo-flags";
import { requireSameOrigin } from "@/lib/origin";
import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import {
  CreditsTransType,
  decreaseCredits,
  getUserCreditSummary,
} from "@/services/credit";
import { getUserUuid } from "@/services/user";

const ConsumeCreditsSchema = z.object({
  credits: z.unknown().optional(),
});

export async function POST(req: Request) {
  if (!isCreditsPlaygroundEnabled()) {
    return respCode("RESOURCE_NOT_FOUND");
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

    const payload = await parseJsonBody(req, ConsumeCreditsSchema, {
      defaultValue: {},
    });

    const credits = Number(payload.credits ?? 1);

    if (!Number.isFinite(credits) || credits <= 0) {
      return respCode("CREDITS_INVALID_AMOUNT");
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
