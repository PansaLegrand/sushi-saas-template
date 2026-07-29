import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  checkRateLimit,
  closeRateLimitStoreForTests,
  getAuthIdentityRateLimitKey,
  getAuthRateLimitBucket,
  resetRateLimitForTests,
} from "@/lib/rate-limit";

function requestForIp(ip: string) {
  return new Request("http://test/api/demo", {
    headers: {
      "x-forwarded-for": ip,
    },
  });
}

function setProductionRateLimitEnv() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_WEB_URL", "https://example.test");
  vi.stubEnv("BETTER_AUTH_URL", "https://example.test");
  vi.stubEnv("NEXT_PUBLIC_AUTH_BASE_URL", "https://example.test");
  vi.stubEnv("DATABASE_URL", "postgresql://app:password@db.test/app");
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "4qJv9K2mW8pT5xR7cN3sL6dF1hY0bGzA",
  );
  vi.stubEnv("CRON_SECRET", "9Nz3wQ6fH1kM8rV4tY7pC2xD5jL0sBaE");
  vi.stubEnv("STRIPE_PRIVATE_KEY", "sk_live_placeholder");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_placeholder");
  vi.stubEnv("STRIPE_BILLING_PORTAL_CONFIGURATION_ID", "bpc_safe1");
  vi.stubEnv("STRIPE_PRICE_PLUS_MONTHLY", "price_1PlusMonth");
  vi.stubEnv("STRIPE_PRICE_PLUS_YEARLY", "price_1PlusYear");
  vi.stubEnv("STRIPE_PRICE_MAX_MONTHLY", "price_1MaxMonth");
  vi.stubEnv("STRIPE_PRICE_MAX_YEARLY", "price_1MaxYear");
  vi.stubEnv("RESEND_API_KEY", "re_placeholder");
  vi.stubEnv("EMAIL_FROM", "App <app@example.test>");
  vi.stubEnv("STORAGE_BUCKET", "test-bucket");
  vi.stubEnv("STORAGE_ACCESS_KEY", "test-access-key");
  vi.stubEnv("STORAGE_SECRET_KEY", "test-storage-secret");
  vi.stubEnv("NEXT_PUBLIC_CAPTCHA_ENABLED", "false");
  vi.stubEnv("RATE_LIMIT_IP_SOURCE", "x-forwarded-for");
}

describe("rate limiter", () => {
  beforeEach(async () => {
    delete process.env.RATE_LIMIT_REDIS_URL;
    resetEnvCacheForTests();
    await closeRateLimitStoreForTests();
    resetRateLimitForTests();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeRateLimitStoreForTests();
  });

  it("allows requests within a bucket limit", async () => {
    const first = await checkRateLimit(requestForIp("203.0.113.1"), "feedback");
    const second = await checkRateLimit(
      requestForIp("203.0.113.1"),
      "feedback",
    );

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    if (second.allowed) {
      expect(second.headers.get("RateLimit-Limit")).toBe("5");
      expect(second.headers.get("RateLimit-Remaining")).toBe("3");
    }
  });

  it("returns 429 after the bucket limit is exceeded", async () => {
    let result = await checkRateLimit(requestForIp("203.0.113.2"), "feedback");

    for (let i = 0; i < 5; i++) {
      result = await checkRateLimit(requestForIp("203.0.113.2"), "feedback");
    }

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.response.status).toBe(429);
      expect(result.response.headers.get("Retry-After")).toBeTruthy();
      expect(result.response.headers.get("RateLimit-Remaining")).toBe("0");
      const payload = await result.response.json();
      expect(payload.error_code).toBe("REQUEST_RATE_LIMITED");
    }
  });

  it("scopes counts by bucket and IP", async () => {
    for (let i = 0; i < 5; i++) {
      await checkRateLimit(requestForIp("203.0.113.3"), "feedback");
    }

    const sameIpOtherBucket = await checkRateLimit(
      requestForIp("203.0.113.3"),
      "checkout",
    );
    const otherIpSameBucket = await checkRateLimit(
      requestForIp("203.0.113.4"),
      "feedback",
    );

    expect(sameIpOtherBucket.allowed).toBe(true);
    expect(otherIpSameBucket.allowed).toBe(true);
  });

  it("uses only the explicitly trusted client-IP header", async () => {
    vi.stubEnv("RATE_LIMIT_IP_SOURCE", "cf-connecting-ip");
    resetEnvCacheForTests();
    resetRateLimitForTests();

    const first = await checkRateLimit(
      new Request("http://test/api/feedback", {
        headers: {
          "cf-connecting-ip": "203.0.113.20",
          "x-forwarded-for": "198.51.100.1",
        },
      }),
      "feedback",
    );
    const second = await checkRateLimit(
      new Request("http://test/api/feedback", {
        headers: {
          "cf-connecting-ip": "203.0.113.20",
          "x-forwarded-for": "198.51.100.2",
        },
      }),
      "feedback",
    );

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    if (second.allowed) {
      // Both requests share the Cloudflare-provided identity; the spoofable XFF
      // values did not split the bucket.
      expect(second.headers.get("RateLimit-Remaining")).toBe("3");
    }
  });

  it.each([
    ["/api/auth/sign-up/email", "auth-signup"],
    ["/api/auth/sign-in/email", "auth-signin"],
    ["/api/auth/sign-in/social", "auth-signin"],
    ["/api/auth/request-password-reset", "auth-recovery"],
    ["/api/auth/send-verification-email", "auth-recovery"],
    ["/api/auth/reset-password", "auth-sensitive"],
    ["/api/auth/change-password", "auth-sensitive"],
    ["/api/auth/two-factor/verify-totp", "auth-sensitive"],
    ["/api/auth/organization/create", "auth"],
  ])("maps %s to the %s bucket", (pathname, expected) => {
    const request = new Request(`http://test${pathname}`);
    expect(getAuthRateLimitBucket(request)).toBe(expected);
  });

  it("derives a canonical hashed account key without retaining the email", async () => {
    const first = new Request("http://test/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: "A.N.N+attempt@Gmail.com" }),
    });
    const second = new Request("http://test/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: "ann@gmail.com" }),
    });

    const firstKey = await getAuthIdentityRateLimitKey(first);
    const secondKey = await getAuthIdentityRateLimitKey(second);

    expect(firstKey).toBe(secondKey);
    expect(firstKey).toMatch(/^account:[a-f0-9]{64}$/);
    expect(firstKey).not.toContain("gmail");
  });

  it("gives signup a dedicated five-per-fifteen-minute window", async () => {
    const req = new Request("http://test/api/auth/sign-up/email", {
      headers: { "x-forwarded-for": "203.0.113.5" },
    });
    const bucket = getAuthRateLimitBucket(req);

    for (let i = 0; i < 5; i++) {
      const result = await checkRateLimit(req, bucket);
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.headers.get("RateLimit-Limit")).toBe("5");
      }
    }

    const blocked = await checkRateLimit(req, bucket);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.response.status).toBe(429);
      expect(blocked.response.headers.get("Retry-After")).toBeTruthy();
    }
  });

  it("fails closed on critical production paths when Redis is unavailable", async () => {
    setProductionRateLimitEnv();
    vi.stubEnv("RATE_LIMIT_REDIS_URL", "redis://127.0.0.1:1");
    resetEnvCacheForTests();
    resetRateLimitForTests();

    const result = await checkRateLimit(
      requestForIp("203.0.113.9"),
      "auth-signup",
    );

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.response.status).toBe(503);
      await expect(result.response.json()).resolves.toMatchObject({
        error_code: "SERVICE_UNAVAILABLE",
      });
    }
  });
});
