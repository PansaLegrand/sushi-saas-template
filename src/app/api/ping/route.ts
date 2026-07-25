import { respData, respErr, respNoAuth } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { requireSameOrigin } from "@/lib/origin";
import {
  CreditsAmount,
  CreditsTransType,
  decreaseCredits,
} from "@/services/credit";
import { getUserUuid } from "@/services/user";
import { rateLimitOrThrow } from "@/lib/rate-limit";

interface PingRequestBody {
  message?: string;
}

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

    let payload: PingRequestBody;
    try {
      payload = (await req.json()) as PingRequestBody;
    } catch (error) {
      return respErr("invalid params");
    }

    if (!payload.message) {
      return respErr("invalid params");
    }

    await decreaseCredits({
      user_uuid: userUuid,
      trans_type: CreditsTransType.Ping,
      credits: CreditsAmount.PingCost,
    });

    return respData({
      pong: `received message: ${payload.message}`,
    });
  } catch (error) {
    return respError(error, {
      logFields: { event: "ping.failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
