import { createHash, timingSafeEqual } from "node:crypto";

import {
  isProductionRuntime,
  isStrongProductionSecret,
} from "@/lib/env";
import { respCode } from "@/lib/errors/response";

function constantTimeMatch(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();

  return timingSafeEqual(providedDigest, expectedDigest);
}

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
      return respCode("AUTH_FORBIDDEN", {
        message: "CRON_SECRET is not set; refusing to run cron endpoint",
        logFields: { operation: "cron.auth", configuration: "missing" },
      });
    }
    // Local development without the variable is allowed so the endpoint can
    // be exercised by hand.
    return null;
  }

  if (isProductionRuntime() && !isStrongProductionSecret(secret)) {
    return respCode("AUTH_FORBIDDEN", {
      message:
        "CRON_SECRET is too short or is a setup placeholder; refusing to run cron endpoint",
      logFields: { operation: "cron.auth", configuration: "weak" },
    });
  }

  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  if (!constantTimeMatch(header, expected)) {
    return respCode("AUTH_REQUIRED", {
      message: "invalid cron credentials",
      logFields: { operation: "cron.auth" },
    });
  }

  return null;
}
