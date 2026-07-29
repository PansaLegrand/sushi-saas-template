import { NextResponse } from "next/server";
import { getAppEnv } from "@/lib/env";
import { absoluteLocaleUrl } from "@/i18n/locale";
import { logger } from "@/lib/logger/server";
import { normalizeLocale } from "@/i18n/locale";
import { resolveStripeCheckoutReturn } from "@/services/checkout";

function redirectTarget(
  configuredPath: string | undefined,
  locale: string,
  status: "success" | "processing" | "failed",
): URL {
  const env = getAppEnv();
  const target = configuredPath || "/";
  const url = /^https?:\/\//i.test(target)
    ? new URL(target)
    : new URL(
        absoluteLocaleUrl(
          env.NEXT_PUBLIC_WEB_URL,
          locale,
          target.startsWith("/") ? target : `/${target}`,
        ),
      );
  url.searchParams.set("checkout", status);
  return url;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const session_id = searchParams.get("session_id");
  const order_no = searchParams.get("order_no");

  let locale = normalizeLocale(searchParams.get("locale"));
  const env = getAppEnv();
  let status: "success" | "processing" | "failed" = "failed";

  if (session_id && order_no) {
    try {
      const result = await resolveStripeCheckoutReturn({
        sessionId: session_id,
        orderNo: order_no,
      });
      locale = normalizeLocale(result.locale);
      status = result.status;
    } catch (error) {
      logger.warn(
        {
          err: error,
          event: "pay.callback_verification_failed",
          stripe_session_id: session_id,
          order_no,
        },
        "Stripe checkout return could not be verified",
      );
    }
  } else {
    logger.warn(
      {
        event: "pay.callback_invalid_params",
        has_session_id: Boolean(session_id),
        has_order_no: Boolean(order_no),
      },
      "handle stripe callback failed: invalid params",
    );
  }

  const configured =
    status === "failed"
      ? env.NEXT_PUBLIC_PAY_FAIL_URL
      : env.NEXT_PUBLIC_PAY_SUCCESS_URL;
  const target = redirectTarget(configured, locale, status);
  return NextResponse.redirect(target, { status: 303 });
}
