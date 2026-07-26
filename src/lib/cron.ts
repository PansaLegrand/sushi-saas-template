import { isProductionRuntime } from "@/lib/env";
import { respForbidden, respNoAuth } from "@/lib/resp";
import { logger } from "@/lib/logger/server";

/**
 * Guard for cron endpoints.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that variable is
 * set on the project. Cron routes are public URLs, so without this check anyone
 * could trigger them.
 *
 * Returns a Response to short-circuit with, or null when the caller is allowed.
 */
export function requireCronAuth(req: Request): Response | null {
  // Read straight from process.env rather than getAppEnv(): the guard must
  // still work when unrelated configuration is missing, otherwise a
  // misconfigured deployment leaves the endpoint unable to authenticate.
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    // Fail closed in production: an unauthenticated cron endpoint is worse
    // than a cron that does not run.
    if (isProductionRuntime()) {
      logger.error(
        { event: "cron.secret_missing" },
        "CRON_SECRET is not set; refusing to run cron endpoint"
      );
      return respForbidden("cron secret not configured");
    }
    // Local development without the variable is allowed so the endpoint can
    // be exercised by hand.
    return null;
  }

  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  if (header.length !== expected.length || header !== expected) {
    return respNoAuth("invalid cron credentials");
  }

  return null;
}
