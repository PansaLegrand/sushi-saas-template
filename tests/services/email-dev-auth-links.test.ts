import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasEmailProviderConfigured,
  logDevAuthEmailLink,
} from "@/services/email/dev-auth-links";
import { resetEnvCacheForTests } from "@/lib/env";

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
      })
    ).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    resetEnvCacheForTests();

    expect(
      logDevAuthEmailLink({
        kind: "verification",
        email: "user@example.com",
        url: "http://localhost:3000/api/auth/verify-email?token=test",
      })
    ).toBe(false);
  });
});
