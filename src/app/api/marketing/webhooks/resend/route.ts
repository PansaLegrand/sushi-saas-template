import { AppError } from "@/lib/errors";
import { respError } from "@/lib/errors/response";
import { respData } from "@/lib/resp";
import { handleResendMarketingWebhook } from "@/services/marketing/provider-webhook";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // Signature verification must receive the exact provider bytes. Parsing
    // and re-stringifying JSON before verification would invalidate the HMAC.
    const payload = await req.text();
    if (new TextEncoder().encode(payload).byteLength > 1024 * 1024) {
      throw new AppError("REQUEST_BODY_TOO_LARGE", {
        details: { maxBytes: 1024 * 1024 },
      });
    }
    return respData(
      await handleResendMarketingWebhook({
        payload,
        headers: req.headers,
      }),
    );
  } catch (error) {
    return respError(error, {
      fallback: "SERVER_ERROR",
      logFields: { event: "marketing.resend_webhook_failed" },
    });
  }
}
