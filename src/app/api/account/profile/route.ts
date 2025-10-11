import { respData, respErr, respNoAuth } from "@/lib/resp";
import { getUserProfileByUuid, getUserUuid } from "@/services/user";
import type { UserInfoRequest } from "@/types/api";

export async function POST(req: Request) {
  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) {
      return respNoAuth();
    }

    let payload: UserInfoRequest = {};
    try {
      payload = (await req.json()) as UserInfoRequest;
    } catch (error) {
      // Absorb JSON parse errors so empty bodies fall back to defaults.
      payload = {};
    }

    const profile = await getUserProfileByUuid(userUuid, {
      includeLedger: payload.includeCreditLedger,
      creditLedgerLimit: payload.creditLedgerLimit,
    });

    if (!profile) {
      return respErr("user not exist", { status: 404 });
    }

    return respData(profile);
  } catch (error) {
    console.error("get user info failed", error);
    return respErr("get user info failed", { status: 500 });
  }
}
