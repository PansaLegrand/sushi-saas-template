import { NextResponse } from "next/server";
import { getAppEnv } from "@/lib/env";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const session_id = searchParams.get("session_id");
  const order_no = searchParams.get("order_no");

  const locale = searchParams.get("locale") || "en";
  const env = getAppEnv();
  let redirectUrl = "";

  if (session_id && order_no) {
    redirectUrl = env.NEXT_PUBLIC_PAY_SUCCESS_URL || "/";
  } else {
    console.warn("handle stripe callback failed: invalid params");
    redirectUrl = env.NEXT_PUBLIC_PAY_FAIL_URL || "/";
  }

  // Build absolute URL and prefix with locale for app routes
  const base = env.NEXT_PUBLIC_WEB_URL;
  const isAbsolute = /^https?:\/\//i.test(redirectUrl);
  const path = redirectUrl.startsWith("/") ? redirectUrl : `/${redirectUrl}`;
  const target = isAbsolute ? redirectUrl : `${base}/${locale}${path}`;
  return NextResponse.redirect(target, { status: 303 });
}
