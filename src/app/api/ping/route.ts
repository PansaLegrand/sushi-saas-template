import { z } from "zod";

import { respData, respNoAuth } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import { requireSameOrigin } from "@/lib/origin";
import {
  CreditsAmount,
  CreditsTransType,
  decreaseCredits,
} from "@/services/credit";
import { getUserUuid } from "@/services/user";
import { rateLimitOrThrow } from "@/lib/rate-limit";

const PingSchema = z.object({
  message: z.string().trim().min(1),
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

    const payload = await parseJsonBody(req, PingSchema);

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
