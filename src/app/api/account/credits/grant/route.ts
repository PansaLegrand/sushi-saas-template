import { z } from "zod";

import { respData, respForbidden, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import {
  CreditsTransType,
  increaseCredits,
  getOrgCreditSummary,
} from "@/services/credit";
import { isAccountCreditGrantEnabled } from "@/lib/demo-flags";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { getOrgContext } from "@/services/authz";

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
    const ctx = await getOrgContext(req);
    if (!ctx) {
      return respNoAuth();
    }

    const payload = await parseJsonBody(req, CreditGrantSchema);
    const credits = Number(payload.credits);

    if (!Number.isFinite(credits) || credits <= 0) {
      return respCode("CREDITS_INVALID_AMOUNT");
    }

    await increaseCredits({
      org_uuid: ctx.orgUuid,
      user_uuid: ctx.userUuid,
      trans_type: CreditsTransType.SystemAdd,
      credits,
      expired_at: payload.expiredAt,
      order_no: payload.orderNo,
      // The member granted to themselves. This endpoint is disabled outside
      // non-production demos, and the actor is what makes a row written while it
      // was briefly enabled distinguishable from one Stripe paid for.
      actor: `user:${ctx.userUuid}`,
      metadata: { source: "demo_grant_endpoint" },
    });

    const summary = await getOrgCreditSummary(ctx.orgUuid, {
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
