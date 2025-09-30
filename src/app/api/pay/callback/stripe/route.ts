import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const session_id = searchParams.get("session_id");
  const order_no = searchParams.get("order_no");

  const locale = searchParams.get("locale") || "en";
  let redirectUrl = "";

  try {
    if (!session_id || !order_no) {
      throw new Error("invalid params");
    }

    redirectUrl = process.env.NEXT_PUBLIC_PAY_SUCCESS_URL || "/";
  } catch (e) {
    console.log("handle stripe callback failed: ", e);
    redirectUrl = process.env.NEXT_PUBLIC_PAY_FAIL_URL || "/";
  }

  // Build absolute URL and prefix with locale for app routes
  const base = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
  const isAbsolute = /^https?:\/\//i.test(redirectUrl);
  const path = redirectUrl.startsWith("/") ? redirectUrl : `/${redirectUrl}`;
  const target = isAbsolute ? redirectUrl : `${base}/${locale}${path}`;
  return NextResponse.redirect(target, { status: 303 });
}
