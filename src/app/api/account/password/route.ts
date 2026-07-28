import { headers } from "next/headers";
import { z } from "zod";

import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import { setInitialPassword } from "@/services/user";

/**
 * Set a first password on an account that signed up through a provider.
 *
 * Exists because of a dead end in the admin path: admin roles must enable
 * two-factor auth, enabling it requires confirming a password, and an account
 * created through Google has none — so a Google-only user could never reach the
 * admin console at all, and the error they got said "invalid password", which
 * sounds like a typo rather than an impossibility.
 *
 * Deliberately cannot *change* a password. Rotating a known password is
 * `changePassword`, which re-authenticates first; accepting both here would let
 * a stolen session overwrite a real password with no check at all.
 */

const SetPasswordSchema = z.object({
  // Better Auth enforces its own configured minimum too. Eight is the floor
  // this route will accept regardless of how that is tuned.
  newPassword: z.string().min(8).max(256),
});

export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  // The `auth` bucket: this is an account-credential change, and it should be
  // throttled alongside sign-in rather than with ordinary API traffic.
  const limited = await rateLimitOrThrow(req, "auth");
  if (limited) return limited;

  let payload: z.infer<typeof SetPasswordSchema>;
  try {
    payload = await parseJsonBody(req, SetPasswordSchema);
  } catch (error) {
    return respError(error, {
      logFields: { event: "account.password.set_invalid" },
      fallback: "REQUEST_VALIDATION_FAILED",
    });
  }

  try {
    // Better Auth reads the session from the incoming headers rather than from
    // a token in the body, so they are forwarded as-is.
    const outcome = await setInitialPassword(await headers(), payload.newPassword);

    if (outcome.status === "unauthenticated") return respNoAuth();

    // Not an error the user caused twice — a second tab, or a stale page.
    // `AUTH_PASSWORD_ALREADY_SET` says which of the two it is.
    if (outcome.status === "already-set") {
      return respCode("AUTH_PASSWORD_ALREADY_SET");
    }

    return respData({ ok: true });
  } catch (error) {
    return respError(error, {
      logFields: { event: "account.password.set_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
