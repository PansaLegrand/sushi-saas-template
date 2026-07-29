import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import {
  checkRateLimit,
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

describe("rate limiter", () => {
  beforeEach(() => {
    delete process.env.RATE_LIMIT_REDIS_URL;
    resetEnvCacheForTests();
    resetRateLimitForTests();
  });

  it("allows requests within a bucket limit", async () => {
    const first = await checkRateLimit(requestForIp("203.0.113.1"), "feedback");
    const second = await checkRateLimit(requestForIp("203.0.113.1"), "feedback");

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

    const sameIpOtherBucket = await checkRateLimit(requestForIp("203.0.113.3"), "checkout");
    const otherIpSameBucket = await checkRateLimit(requestForIp("203.0.113.4"), "feedback");

    expect(sameIpOtherBucket.allowed).toBe(true);
    expect(otherIpSameBucket.allowed).toBe(true);
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

});
