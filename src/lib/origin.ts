import { getAppEnv } from "@/lib/env";
import { respForbidden } from "@/lib/resp";

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export interface SameOriginOptions {
  /**
   * Extra origins to accept alongside the request URL. Used by the admin app,
   * which is served from its own origin and sits behind a proxy where
   * `req.url` is the internal host rather than the public one.
   */
  allowedOrigins?: (string | undefined | null)[];
  /**
   * Whether `NEXT_PUBLIC_WEB_URL` counts as an allowed origin. The admin app
   * sets this to `false`: the public site is same-*site* with an
   * `admin.` subdomain, so SameSite=Lax does not stop it from sending admin
   * cookies, and this check is what keeps the two apps isolated.
   */
  includeWebUrl?: boolean;
}

function getAllowedOrigins(
  req: Request,
  options: SameOriginOptions
): Set<string> {
  const env = getAppEnv();
  const origins = [
    normalizeOrigin(req.url),
    options.includeWebUrl === false
      ? null
      : normalizeOrigin(env.NEXT_PUBLIC_WEB_URL),
    ...(options.allowedOrigins ?? []).map(normalizeOrigin),
  ].filter((origin): origin is string => Boolean(origin));

  return new Set(origins);
}

export function requireSameOrigin(
  req: Request,
  options: SameOriginOptions = {}
): Response | null {
  const allowedOrigins = getAllowedOrigins(req, options);
  const rawOrigin = req.headers.get("origin");
  const rawReferer = req.headers.get("referer");
  const origin = normalizeOrigin(rawOrigin);
  const referer = normalizeOrigin(rawReferer);
  const fetchSite = req.headers.get("sec-fetch-site")?.toLowerCase();

  if (rawOrigin && !origin) {
    return respForbidden("invalid origin");
  }

  if (origin && !allowedOrigins.has(origin)) {
    return respForbidden("invalid origin");
  }

  if (!origin && rawReferer && !referer) {
    return respForbidden("invalid referer");
  }

  if (!origin && referer && !allowedOrigins.has(referer)) {
    return respForbidden("invalid referer");
  }

  if (!origin && !referer && fetchSite === "cross-site") {
    return respForbidden("invalid origin");
  }

  return null;
}
