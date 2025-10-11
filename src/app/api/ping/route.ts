import { respData, respErr, respNoAuth } from "@/lib/resp";
import {
  CreditsAmount,
  CreditsTransType,
  decreaseCredits,
} from "@/services/credit";
import { getUserUuid } from "@/services/user";

interface PingRequestBody {
  message?: string;
}

export async function POST(req: Request) {
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
    const message =
      error instanceof Error ? error.message : "ping failed";

    if (message === "insufficient credits") {
      return respErr("insufficient credits");
    }

    console.error("ping failed", error);
    return respErr("ping failed", { status: 500 });
  }
}
