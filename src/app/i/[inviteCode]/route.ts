import { NextResponse } from "next/server";
import { findUserByInviteCode } from "@/models/user";
import { AffiliateConfig } from "@/data/affiliate";

export async function GET(_req: Request, ctx: any) {
  const { inviteCode } = (ctx?.params || {}) as { inviteCode: string };

  try {
    const inviter = await findUserByInviteCode(inviteCode);
    const redirectTo = new URL("/", process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000");

    const res = NextResponse.redirect(redirectTo);

    if (inviter && inviter.uuid) {
      // Set referral cookie for attribution window
      const maxAge = AffiliateConfig.attributionWindowDays * 24 * 60 * 60; // seconds
      res.cookies.set(AffiliateConfig.cookieName, inviter.uuid, {
        maxAge,
        httpOnly: false, // readable by client if needed
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      });
    }

    return res;
  } catch (e) {
    // On any error, just redirect normally
    return NextResponse.redirect(new URL("/", process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000"));
  }
}
