import { z } from "zod";

import { respData, respNoAuth } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import { requireSameOrigin } from "@/lib/origin";
import { getUserCreditSummary } from "@/services/credit";
import { getUserUuid } from "@/services/user";
import { rateLimitOrThrow } from "@/lib/rate-limit";

const CreditQuerySchema = z.object({
  includeLedger: z.boolean().optional(),
  ledgerLimit: z.coerce.number().int().positive().max(500).optional(),
  includeExpiring: z.boolean().optional(),
});

export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "credits");
  if (limited) return limited;

  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) {
      return respNoAuth();
    }

    const payload = await parseJsonBody(req, CreditQuerySchema, {
      defaultValue: {},
    });

    const summary = await getUserCreditSummary(userUuid, {
      includeLedger: payload.includeLedger,
      ledgerLimit: payload.ledgerLimit,
      includeExpiring: payload.includeExpiring,
    });

    return respData(summary);
  } catch (error) {
    return respError(error, {
      logFields: { event: "account.credits_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
