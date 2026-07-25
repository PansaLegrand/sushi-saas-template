import { z } from "zod";

import { respData, respForbidden, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import {
  CreditsTransType,
  increaseCredits,
  getUserCreditSummary,
} from "@/services/credit";
import { isAccountCreditGrantEnabled } from "@/lib/demo-flags";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { getUserUuid } from "@/services/user";

const CreditGrantSchema = z.object({
  credits: z.unknown(),
  orderNo: z.string().optional(),
  expiredAt: z.string().optional(),
  ledgerLimit: z.coerce.number().int().positive().max(500).optional(),
});

export async function POST(req: Request) {
  if (!isAccountCreditGrantEnabled()) {
    return respForbidden("account credit grant is disabled");
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

    const payload = await parseJsonBody(req, CreditGrantSchema);
    const credits = Number(payload.credits);

    if (!Number.isFinite(credits) || credits <= 0) {
      return respCode("CREDITS_INVALID_AMOUNT");
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
    return respError(error, {
      logFields: { event: "credits.grant_failed" },
      fallback: "CREDITS_GRANT_FAILED",
    });
  }
}
