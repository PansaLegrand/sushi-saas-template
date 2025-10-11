import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";

// Compose next-intl middleware with request id propagation
const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  const existing = request.headers.get("x-request-id");
  const requestId = existing || crypto.randomUUID();

  const res = intlMiddleware(request);
  // Set a response header for visibility only; avoid overriding request headers
  // to prevent interfering with auth cookies/session handling.
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: [
    "/",
    "/(en|en-US|zh|zh-CN|zh-TW|zh-HK|zh-MO|ja|ko|ru|fr|de|ar|es|it)/:path*",
    "/((?!api|_next|_vercel|admin|.*\\..*).*)",
  ],
};
