/**
 * Cloudflare Turnstile configuration shared by the server plugin and the client
 * widget.
 *
 * The Better Auth captcha plugin matches these paths as substrings of the
 * request URL and rejects the request with 400 when the `x-captcha-response`
 * header is absent, so every client call to a protected endpoint must attach a
 * token.
 */

export const CAPTCHA_HEADER = "x-captcha-response";

/**
 * Endpoints guarded by the challenge. Beyond the plugin's own defaults this
 * adds the two remaining paths that send mail to an arbitrary address:
 * `/request-password-reset` (what `authClient.requestPasswordReset` calls) and
 * `/send-verification-email`.
 */
export const CAPTCHA_PROTECTED_ENDPOINTS = [
  "/sign-up/email",
  "/sign-in/email",
  "/forget-password",
  "/request-password-reset",
  "/send-verification-email",
] as const;

/**
 * Client-safe flag. Reads the inlined public env directly rather than through
 * `getAppEnv()`, which is server-oriented.
 */
export function isCaptchaEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_CAPTCHA_ENABLED;
  const enabled = flag === undefined || flag === "" || flag === "true" || flag === "1";

  return enabled && Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

export function getCaptchaSiteKey(): string | undefined {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined;
}

/**
 * Header bag for a Better Auth client call. Empty when the challenge is off, so
 * callers can spread it unconditionally.
 */
export function captchaHeaders(token: string | null): Record<string, string> {
  if (!isCaptchaEnabled() || !token) return {};

  return { [CAPTCHA_HEADER]: token };
}
