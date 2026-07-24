import { getAppEnv } from "@/lib/env";
import { requireSameOrigin as requireSameOriginShared } from "@/lib/origin";

/**
 * Same-origin guard for admin routes.
 *
 * Delegates to the shared implementation so this app cannot drift behind on
 * hardening, but narrows the allowlist to the admin origin only: the public web
 * app must never be able to drive admin mutations, and on an `admin.` subdomain
 * it is same-site, so SameSite=Lax alone would not stop it.
 */
export function requireSameOrigin(req: Request): Response | null {
  return requireSameOriginShared(req, {
    includeWebUrl: false,
    allowedOrigins: [getAppEnv().NEXT_PUBLIC_ADMIN_WEB_URL],
  });
}
