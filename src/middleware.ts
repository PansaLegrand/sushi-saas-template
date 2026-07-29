import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";

import {
  ORGANIZATION_CONTEXT_MODE_HEADER,
  ORGANIZATION_HEADER,
  ORGANIZATION_QUERY_PARAM,
  normalizeOrganizationSlug,
} from "@/config/organization-context";
import { routing } from "@/i18n/routing";
import { normalizeRequestId } from "@/lib/logger/request-id";

/**
 * This file must live in `src/`, not the repository root. Next silently ignores
 * a root middleware file when the project uses a `src` directory.
 */
const intlMiddleware = createMiddleware(routing);

function requestHeadersWithContext(
  request: NextRequest,
  requestId: string,
  isApi: boolean
): Headers {
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  headers.set(ORGANIZATION_CONTEXT_MODE_HEADER, isApi ? "api" : "page");

  const querySlug = normalizeOrganizationSlug(
    request.nextUrl.searchParams.get(ORGANIZATION_QUERY_PARAM)
  );
  const headerSlug = isApi
    ? normalizeOrganizationSlug(request.headers.get(ORGANIZATION_HEADER))
    : null;
  const selectedSlug = querySlug ?? headerSlug;

  // A page's organization comes only from its URL. This deliberately drops a
  // caller-supplied page header so links remain inspectable and shareable.
  if (selectedSlug) {
    headers.set(ORGANIZATION_HEADER, selectedSlug);
  } else {
    headers.delete(ORGANIZATION_HEADER);
  }

  return headers;
}

/**
 * Copy Next's internal request-header override metadata onto an intl response.
 *
 * `next-intl` owns locale rewrites, while `NextResponse.next({request})` owns
 * forwarding changed headers to the route. Combining their response headers is
 * what makes the same request id visible to route logs instead of adding it
 * only after the request has already completed.
 */
function forwardRequestHeaders(
  response: NextResponse,
  requestHeaders: Headers
): void {
  const forwarding = NextResponse.next({ request: { headers: requestHeaders } });

  for (const [name, value] of forwarding.headers) {
    if (
      name === "x-middleware-override-headers" ||
      name.startsWith("x-middleware-request-")
    ) {
      response.headers.set(name, value);
    }
  }
}

export default function middleware(request: NextRequest) {
  const requestId = normalizeRequestId(request.headers.get("x-request-id"));
  const isApi = request.nextUrl.pathname.startsWith("/api");
  const requestHeaders = requestHeadersWithContext(request, requestId, isApi);

  // API routes never participate in locale negotiation.
  if (isApi) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("x-request-id", requestId);
    return response;
  }

  const response = intlMiddleware(request);
  forwardRequestHeaders(response, requestHeaders);
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: [
    "/",
    "/(en|en-US|zh|zh-CN|zh-TW|zh-HK|zh-MO|ja|ko|ru|fr|de|ar|es|it)/:path*",
    "/api/:path*",
    "/((?!_next|_vercel|admin|.*\\..*).*)",
  ],
};
