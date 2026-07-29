import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasEmailProviderConfigured,
  logDevAuthEmailLink,
  sendAuthEmailOrLogDevLink,
  shouldLogAuthLinkInsteadOfSending,
} from "@/services/email/dev-auth-links";
import { resetEnvCacheForTests, validateAppEnv } from "@/lib/env";

/** A configured provider, so the flag is the only thing under test. */
function withProvider() {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Test <test@example.com>");
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
});

describe("dev auth email links", () => {
  it("detects when local email delivery is not configured", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    resetEnvCacheForTests();

    expect(hasEmailProviderConfigured()).toBe(false);
  });

  it("prints auth links outside production only", () => {
    vi.stubEnv("NODE_ENV", "development");
    resetEnvCacheForTests();

    expect(
      logDevAuthEmailLink({
        kind: "verification",
        email: "user@example.com",
        url: "http://localhost:3000/api/auth/verify-email?token=test",
      }),
    ).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    resetEnvCacheForTests();

    expect(
      logDevAuthEmailLink({
        kind: "verification",
        email: "user@example.com",
        url: "http://localhost:3000/api/auth/verify-email?token=test",
      }),
    ).toBe(false);
  });
});

describe("AUTH_DEV_EMAIL_LINKS", () => {
  it("sends normally when a provider is configured and the flag is off", () => {
    vi.stubEnv("NODE_ENV", "development");
    withProvider();
    vi.stubEnv("AUTH_DEV_EMAIL_LINKS", "false");
    resetEnvCacheForTests();

    expect(shouldLogAuthLinkInsteadOfSending()).toBe(false);
  });

  it("logs instead of sending when the flag is on", () => {
    // The case the flag exists for: a real Resend key in .env would otherwise
    // mail every local signup and password reset to a real inbox.
    vi.stubEnv("NODE_ENV", "development");
    withProvider();
    vi.stubEnv("AUTH_DEV_EMAIL_LINKS", "true");
    resetEnvCacheForTests();

    expect(shouldLogAuthLinkInsteadOfSending()).toBe(true);
  });

  it("still logs when no provider is configured, flag or not", () => {
    // The original behaviour, unchanged: a fresh clone must not strand its
    // first account behind an email it cannot send.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("AUTH_DEV_EMAIL_LINKS", "false");
    resetEnvCacheForTests();

    expect(shouldLogAuthLinkInsteadOfSending()).toBe(true);
  });

  it("never diverts mail in production, whatever the flag says", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("npm_lifecycle_event", "start");
    withProvider();
    vi.stubEnv("AUTH_DEV_EMAIL_LINKS", "true");
    resetEnvCacheForTests();

    expect(shouldLogAuthLinkInsteadOfSending()).toBe(false);
  });

  it("refuses to boot production with the flag set", () => {
    // The lock that matters. Silently logging reset links in production would
    // look healthy while locking out every user who forgot a password, so the
    // server must not start at all rather than start wrong.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("npm_lifecycle_event", "start");
    vi.stubEnv("AUTH_DEV_EMAIL_LINKS", "true");
    resetEnvCacheForTests();

    expect(() => validateAppEnv()).toThrow(/AUTH_DEV_EMAIL_LINKS/);
  });
});

describe("sendAuthEmailOrLogDevLink", () => {
  it("surfaces a production delivery failure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("npm_lifecycle_event", "start");
    withProvider();
    resetEnvCacheForTests();

    await expect(
      sendAuthEmailOrLogDevLink({
        kind: "password_reset",
        email: "user@example.com",
        url: "https://app.example/reset",
        send: async () => {
          throw new Error("provider unavailable");
        },
      }),
    ).rejects.toThrow("provider unavailable");
  });

  it("falls back to a visible local link when development delivery fails", async () => {
    vi.stubEnv("NODE_ENV", "development");
    withProvider();
    vi.stubEnv("AUTH_DEV_EMAIL_LINKS", "false");
    resetEnvCacheForTests();

    await expect(
      sendAuthEmailOrLogDevLink({
        kind: "verification",
        email: "user@example.com",
        url: "http://localhost:3000/verify",
        send: async () => {
          throw new Error("provider unavailable");
        },
      }),
    ).resolves.toBeUndefined();
  });
});
