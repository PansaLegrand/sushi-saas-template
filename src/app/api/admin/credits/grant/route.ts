import { requireAdminWrite } from "@/lib/authz";
import { respData, respErr } from "@/lib/resp";
import {
  CreditsTransType,
  increaseCredits,
  getUserCreditSummary,
} from "@/services/credit";

interface AdminGrantRequest {
  userUuid: string;
  credits: number;
  expiredAt?: string | Date | null;
  orderNo?: string;
  note?: string; // reserved for future audit logging
}

export async function POST(req: Request) {
  const authz = await requireAdminWrite();
  if (authz instanceof Response) return authz;

  try {
    let payload: AdminGrantRequest | null = null;
    try {
      payload = (await req.json()) as AdminGrantRequest;
    } catch {
      return respErr("invalid params");
    }

    if (!payload?.userUuid) return respErr("userUuid required");
    const credits = Number(payload.credits);
    if (!Number.isFinite(credits) || credits <= 0)
      return respErr("credits must be a positive number");

    await increaseCredits({
      user_uuid: payload.userUuid,
      trans_type: CreditsTransType.SystemAdd,
      credits,
      expired_at: payload.expiredAt,
      order_no: payload.orderNo,
    });

    const summary = await getUserCreditSummary(payload.userUuid, {
      includeLedger: true,
      ledgerLimit: 50,
    });

    return respData({
      userUuid: payload.userUuid,
      creditsGranted: credits,
      summary,
    });
  } catch (e) {
    console.error("admin grant credits failed", e);
    return respErr("admin grant credits failed");
  }
}

