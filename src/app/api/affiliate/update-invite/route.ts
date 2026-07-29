import { cookies } from "next/headers";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respOk, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { getUserUuid } from "@/services/user";
import { applyAffiliateAttribution } from "@/services/affiliate";
import { AffiliateConfig } from "@/config/affiliate";

export async function POST(req: Request) {
  if (!AffiliateConfig.enabled) return respCode("RESOURCE_NOT_FOUND");

  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "auth");
  if (limited) return limited;

  const userUuid = await getUserUuid(req);
  if (!userUuid) {
    return respNoAuth();
  }

  try {
    const c = await cookies();
    const ref = c.get(AffiliateConfig.cookieName)?.value || "";

    if (!ref) return respOk();

    await applyAffiliateAttribution({
      userUuid,
      referrerUuid: ref,
    });

    return respOk();
  } catch (error) {
    return respError(error, {
      logFields: { event: "affiliate.attribution_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
