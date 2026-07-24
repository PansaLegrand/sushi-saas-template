/**
 * Turnstile wiring.
 *
 * The endpoint list is asserted explicitly because the Better Auth captcha
 * plugin matches these as substrings of the request URL: a typo silently means
 * "no challenge on that endpoint" rather than an error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPTCHA_HEADER,
  CAPTCHA_PROTECTED_ENDPOINTS,
  captchaHeaders,
  getCaptchaSiteKey,
  isCaptchaEnabled,
} from "@/lib/captcha";

describe("captcha configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("guards every credential and mail-sending endpoint", () => {
    expect(CAPTCHA_PROTECTED_ENDPOINTS).toEqual([
      "/sign-up/email",
      "/sign-in/email",
      "/forget-password",
      "/request-password-reset",
      "/send-verification-email",
    ]);
  });

  it("is disabled when no site key is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");

    expect(isCaptchaEnabled()).toBe(false);
    expect(getCaptchaSiteKey()).toBeUndefined();
  });

  it("is enabled when a site key is present", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");

    expect(isCaptchaEnabled()).toBe(true);
    expect(getCaptchaSiteKey()).toBe("site-key");
  });

  it("respects an explicit opt-out even with a site key", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    vi.stubEnv("NEXT_PUBLIC_CAPTCHA_ENABLED", "false");

    expect(isCaptchaEnabled()).toBe(false);
  });

  it("emits the header Better Auth expects", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");

    expect(captchaHeaders("token-123")).toEqual({
      [CAPTCHA_HEADER]: "token-123",
    });
    expect(CAPTCHA_HEADER).toBe("x-captcha-response");
  });

  it("emits no header when there is no token or the challenge is off", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    expect(captchaHeaders(null)).toEqual({});

    vi.stubEnv("NEXT_PUBLIC_CAPTCHA_ENABLED", "false");
    expect(captchaHeaders("token-123")).toEqual({});
  });
});
