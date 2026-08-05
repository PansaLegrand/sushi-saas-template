import { respError } from "@/lib/errors/response";
import { unsubscribeFromMarketingToken } from "@/services/marketing/subscriptions";

const responseHeaders = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body style="margin:0;background:#f4f3ee;color:#15201d;font-family:Arial,sans-serif"><main style="max-width:560px;margin:10vh auto;padding:36px;background:#fff;border-radius:16px"><h1 style="margin-top:0">${title}</h1>${body}</main></body></html>`,
    { status: 200, headers: responseHeaders },
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("test") === "1") {
    return page(
      "Test email",
      "<p>This unsubscribe link is intentionally inactive because this was a test delivery.</p>",
    );
  }
  const token = url.searchParams.get("token") ?? "";
  if (!token) {
    return page(
      "Invalid link",
      "<p>This unsubscribe link is incomplete or invalid.</p>",
    );
  }

  const action = `/api/marketing/unsubscribe?token=${encodeURIComponent(token)}`;
  return page(
    "Unsubscribe from marketing email?",
    `<p>You will stop receiving this category of marketing email. Account, security, billing, and other transactional messages are unaffected.</p><form method="post" action="${action}"><button type="submit" style="border:0;border-radius:9px;background:#15856f;color:#fff;padding:12px 18px;font-size:16px;font-weight:700;cursor:pointer">Confirm unsubscribe</button></form>`,
  );
}

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  try {
    await unsubscribeFromMarketingToken(token);
    if (req.headers.get("accept")?.includes("application/json")) {
      return Response.json({ unsubscribed: true });
    }
    return page(
      "You are unsubscribed",
      "<p>Your marketing preference has been updated. Transactional account email remains enabled.</p>",
    );
  } catch (error) {
    return respError(error, {
      fallback: "AUTH_INVALID_TOKEN",
      logFields: { event: "marketing.unsubscribe_failed" },
    });
  }
}
