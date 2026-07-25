import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { locales } from "@/i18n/locale";

/**
 * This file must live in `src/`, not the repository root.
 *
 * Next resolves middleware at `src/middleware.ts` whenever a `src` directory
 * exists, and silently ignores a root-level one. There used to be a copy in
 * both places; the root copy was dead code that looked authoritative, so edits
 * to it had no effect at all.
 */

// Compose next-intl middleware with request id propagation
const intlMiddleware = createMiddleware(routing);

/**
 * Path segments a `site` deployment serves. Everything else 404s.
 *
 * Matched against the first segment after the locale. A marketing and docs site
 * has no database behind it, so a signed-in surface would not merely be unused —
 * it would throw on its first query.
 *
 * Gating here rather than with `notFound()` in each page is the point: a route
 * added next month is blocked by default instead of blocked only if whoever
 * adds it remembers. `/api/health` stays open so uptime checks keep working.
 */
const SITE_MODE_ALLOWED_SEGMENTS = new Set(["docs", "blogs"]);

const LOCALE_PREFIX = new RegExp(`^/(?:${locales.join("|")})(?=/|$)`);

/** A real route whose only job is to call `notFound()`. See that file. */
const SITE_MODE_BLOCKED_SEGMENT = "not-available";

function localeOf(pathname: string): string {
  return LOCALE_PREFIX.exec(pathname)?.[0].slice(1) ?? routing.defaultLocale;
}

function isAllowedInSiteMode(pathname: string): boolean {
  if (pathname === "/api/health") return true;

  const withoutLocale = pathname.replace(LOCALE_PREFIX, "") || "/";
  if (withoutLocale === "/") return true;

  const [segment] = withoutLocale.split("/").filter(Boolean);
  return segment !== undefined && SITE_MODE_ALLOWED_SEGMENTS.has(segment);
}

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const existing = request.headers.get("x-request-id");
  const requestId = existing || crypto.randomUUID();

  // Read the raw env rather than SiteConfig: this runs on the edge runtime,
  // where importing the config would pull the whole zod schema into every
  // request. Either way it is a build-time inlined NEXT_PUBLIC_ value.
  if (process.env.NEXT_PUBLIC_SITE_MODE === "site" && !isAllowedInSiteMode(pathname)) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json(
        { code: -4, message: "not found" },
        { status: 404, headers: { "x-request-id": requestId } }
      );
    }

    return NextResponse.rewrite(
      new URL(`/${localeOf(pathname)}/${SITE_MODE_BLOCKED_SEGMENT}`, request.url)
    );
  }

  // API routes are matched so site mode can block them, but they must never see
  // the intl middleware — locale negotiation would rewrite or redirect them.
  if (pathname.startsWith("/api")) {
    const res = NextResponse.next();
    res.headers.set("x-request-id", requestId);
    return res;
  }

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
    // Matched on purpose: in site mode the SaaS endpoints must be unreachable,
    // and they sit outside the locale-prefixed tree.
    "/api/:path*",
    "/((?!_next|_vercel|admin|.*\\..*).*)",
  ],
};
