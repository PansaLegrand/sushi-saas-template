import { getAppEnv, isProductionRuntime } from "@/lib/env";
import { logger } from "@/lib/logger/server";

export type AuthEmailLinkKind = "password_reset" | "verification";

const LABELS: Record<AuthEmailLinkKind, string> = {
  password_reset: "Reset password",
  verification: "Verify email",
};

export function hasEmailProviderConfigured(): boolean {
  const env = getAppEnv();
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

/**
 * Should this auth link go to the log instead of an inbox?
 *
 * Two independent reasons, both local-only:
 *
 * 1. **No provider configured.** The original case — a fresh clone would
 *    otherwise strand the first account behind a verification email it can
 *    never send.
 * 2. **`AUTH_DEV_EMAIL_LINKS=true`.** The case that only shows up later: once a
 *    real `RESEND_API_KEY` is in `.env`, every local signup and password reset
 *    starts sending real mail to a real inbox. This opts back out without
 *    deleting the key, so the same `.env` can do both.
 *
 * Never true in production, whatever the flag says — and `validateAppEnv()`
 * refuses to boot a production runtime with the flag set, so this is the second
 * of two locks rather than the only one.
 */
export function shouldLogAuthLinkInsteadOfSending(): boolean {
  if (isProductionRuntime()) return false;

  return !hasEmailProviderConfigured() || getAppEnv().AUTH_DEV_EMAIL_LINKS;
}

export function logDevAuthEmailLink(input: {
  kind: AuthEmailLinkKind;
  email: string;
  url: string;
  reason?: string;
}): boolean {
  if (isProductionRuntime()) return false;

  // Single line, URL last. The dev logger runs plain Pino with no `pino-pretty`
  // transport, so the message is read inside a JSON string — a multi-line block
  // arrives as literal `\n` escapes, which is harder to read than the thing it
  // was trying to improve. The URL is also its own `url` field, so
  // `pnpm dev | grep dev_link` gets it without the surrounding noise.
  logger.info(
    {
      event: "auth.email.dev_link",
      kind: input.kind,
      email: input.email,
      url: input.url,
      reason: input.reason,
    },
    `[dev auth] ${LABELS[input.kind]} link for ${input.email} -> ${input.url}`,
  );

  return true;
}

/**
 * Deliver an authentication email, or expose its link only in local mode.
 *
 * A production delivery failure rejects the auth request. Returning success
 * would tell a user to check an inbox that can never receive the recovery or
 * verification link.
 */
export async function sendAuthEmailOrLogDevLink(input: {
  kind: AuthEmailLinkKind;
  email: string;
  url: string;
  send: () => Promise<unknown>;
}): Promise<void> {
  if (shouldLogAuthLinkInsteadOfSending()) {
    logDevAuthEmailLink({
      kind: input.kind,
      email: input.email,
      url: input.url,
      reason: hasEmailProviderConfigured()
        ? "dev_email_links_enabled"
        : "email_provider_missing",
    });
    return;
  }

  try {
    await input.send();
  } catch (error) {
    const loggedDevLink = logDevAuthEmailLink({
      kind: input.kind,
      email: input.email,
      url: input.url,
      reason: "email_send_failed",
    });

    if (loggedDevLink) return;

    logger.error(
      { err: error, event: "auth.email_send_failed", kind: input.kind },
      "failed to send auth email",
    );
    throw error;
  }
}
