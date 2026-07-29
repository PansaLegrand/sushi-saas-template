import { NextResponse } from "next/server";
import { findUserByInviteCode } from "@/models/user";
import { AffiliateConfig } from "@/config/affiliate";
import { getAppEnv } from "@/lib/env";
import { absoluteLocaleUrl } from "@/i18n/locale";

export async function GET(_req: Request, ctx: any) {
  const { inviteCode, locale } = (await (ctx?.params || {})) as {
    locale: string;
    inviteCode: string;
  };
  const base = getAppEnv().NEXT_PUBLIC_WEB_URL;
  const redirectTo = absoluteLocaleUrl(base, locale, "/signup");
  if (!AffiliateConfig.enabled) {
    return NextResponse.redirect(redirectTo);
  }

  try {
    const inviter = await findUserByInviteCode(inviteCode);

    const res = NextResponse.redirect(redirectTo);

    if (inviter && inviter.uuid) {
      const maxAge = AffiliateConfig.attributionWindowDays * 24 * 60 * 60; // seconds
      res.cookies.set(AffiliateConfig.cookieName, inviter.uuid, {
        maxAge,
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      });
    }

    return res;
  } catch (e) {
    return NextResponse.redirect(absoluteLocaleUrl(base, locale));
  }
}
