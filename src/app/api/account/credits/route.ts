import { respData, respErr, respNoAuth } from "@/lib/resp";
import { requireSameOrigin } from "@/lib/origin";
import { getUserCreditSummary } from "@/services/credit";
import { getUserUuid } from "@/services/user";
import type { CreditQueryRequest } from "@/types/api";
import { rateLimitOrThrow } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = rateLimitOrThrow(req, "credits");
  if (limited) return limited;

  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) {
      return respNoAuth();
    }

    let payload: CreditQueryRequest = {};
    try {
      payload = (await req.json()) as CreditQueryRequest;
    } catch (error) {
      // Absorb JSON parse errors so empty bodies fall back to defaults.
      payload = {};
    }

    const summary = await getUserCreditSummary(userUuid, {
      includeLedger: payload.includeLedger,
      ledgerLimit: payload.ledgerLimit,
      includeExpiring: payload.includeExpiring,
    });

    return respData(summary);
  } catch (error) {
    console.error("get user credits failed", error);
    return respErr("get user credits failed", { status: 500 });
  }
}
