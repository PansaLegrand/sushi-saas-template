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

function getAllowedOrigins(req: Request): Set<string> {
  const env = getAppEnv();
  const origins = [
    normalizeOrigin(req.url),
    normalizeOrigin(env.NEXT_PUBLIC_WEB_URL),
  ].filter((origin): origin is string => Boolean(origin));

  return new Set(origins);
}

export function requireSameOrigin(req: Request): Response | null {
  const allowedOrigins = getAllowedOrigins(req);
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
