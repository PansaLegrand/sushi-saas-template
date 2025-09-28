import { NextResponse } from "next/server";
import { findUserByInviteCode } from "@/models/user";
import { AffiliateConfig } from "@/data/affiliate";

export async function GET(_req: Request, ctx: any) {
  const { inviteCode, locale } = await (ctx?.params || {}) as {
    locale: string;
    inviteCode: string;
  };

  try {
    const inviter = await findUserByInviteCode(inviteCode);
    const base = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
    const redirectTo = new URL(`/${locale}/signup`, base);

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
    const base = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
    return NextResponse.redirect(new URL(`/${locale}`, base));
  }
}
