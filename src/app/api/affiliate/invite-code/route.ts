import { respData, respNoAuth, respOk } from "@/lib/resp";
import { respCode } from "@/lib/errors/response";
import { requireSameOrigin } from "@/lib/origin";
import { getUserUuid } from "@/services/user";
import { AffiliateConfig } from "@/config/affiliate";
import { getAppEnv } from "@/lib/env";
import {
  ensureAffiliateInviteCode,
  getAffiliateInviteCode,
} from "@/services/affiliate";

function toShareUrl(code: string): string {
  const base = getAppEnv().NEXT_PUBLIC_WEB_URL;
  return `${base}${AffiliateConfig.sharePath}/${code}`;
}

export async function GET(req: Request) {
  if (!AffiliateConfig.enabled) return respCode("RESOURCE_NOT_FOUND");

  const userUuid = await getUserUuid(req);
  if (!userUuid) return respNoAuth();

  const inviteCode = await getAffiliateInviteCode(userUuid);
  if (!inviteCode) return respOk();

  return respData({
    inviteCode,
    shareUrl: toShareUrl(inviteCode),
  });
}

export async function POST(req: Request) {
  if (!AffiliateConfig.enabled) return respCode("RESOURCE_NOT_FOUND");

  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const userUuid = await getUserUuid(req);
  if (!userUuid) return respNoAuth();

  const url = new URL(req.url);
  const regen = url.searchParams.get("regen");

  const code = await ensureAffiliateInviteCode({
    userUuid,
    regenerate: Boolean(regen),
  });
  if (!code) return respOk();

  return respData({
    inviteCode: code,
    shareUrl: toShareUrl(code),
  });
}
