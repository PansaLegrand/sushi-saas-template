import { respData, respNoAuth, respOk } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import {
  findUserByInviteCode,
  findUserByUuid,
  updateUserInviteCode,
} from "@/models/user";
import { AffiliateConfig } from "@/data/affiliate";
import { getSnowId } from "@/lib/hash";

function toShareUrl(code: string): string {
  const base = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
  return `${base}${AffiliateConfig.sharePath}/${code}`;
}

async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    // short base36 from snowflake id
    const code = Number.parseInt(getSnowId(), 10).toString(36).slice(-8);
    const exists = await findUserByInviteCode(code);
    if (!exists) return code;
  }

  // Fallback to a longer code
  return `ref-${getSnowId()}`;
}

export async function GET(req: Request) {
  const userUuid = await getUserUuid(req);
  if (!userUuid) return respNoAuth();

  const user = await findUserByUuid(userUuid);
  if (!user) return respOk();

  return respData({ inviteCode: user.invite_code, shareUrl: toShareUrl(user.invite_code) });
}

export async function POST(req: Request) {
  const userUuid = await getUserUuid(req);
  if (!userUuid) return respNoAuth();

  const url = new URL(req.url);
  const regen = url.searchParams.get("regen");

  const user = await findUserByUuid(userUuid);
  if (!user) return respOk();

  if (!regen && user.invite_code) {
    return respData({ inviteCode: user.invite_code, shareUrl: toShareUrl(user.invite_code) });
  }

  const code = await generateUniqueCode();
  const updated = await updateUserInviteCode(userUuid, code);

  return respData({ inviteCode: updated?.invite_code ?? code, shareUrl: toShareUrl(code) });
}

