import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimitForTests } from "@/lib/rate-limit";

function requestForIp(ip: string) {
  return new Request("http://test/api/demo", {
    headers: {
      "x-forwarded-for": ip,
    },
  });
}

describe("rate limiter", () => {
  beforeEach(() => {
    resetRateLimitForTests();
  });

  it("allows requests within a bucket limit", () => {
    const first = checkRateLimit(requestForIp("203.0.113.1"), "feedback");
    const second = checkRateLimit(requestForIp("203.0.113.1"), "feedback");

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    if (second.allowed) {
      expect(second.headers.get("RateLimit-Limit")).toBe("5");
      expect(second.headers.get("RateLimit-Remaining")).toBe("3");
    }
  });

  it("returns 429 after the bucket limit is exceeded", async () => {
    let result = checkRateLimit(requestForIp("203.0.113.2"), "feedback");

    for (let i = 0; i < 5; i++) {
      result = checkRateLimit(requestForIp("203.0.113.2"), "feedback");
    }

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.response.status).toBe(429);
      expect(result.response.headers.get("Retry-After")).toBeTruthy();
      expect(result.response.headers.get("RateLimit-Remaining")).toBe("0");
      const payload = await result.response.json();
      expect(payload.message).toBe("rate limit exceeded");
    }
  });

  it("scopes counts by bucket and IP", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit(requestForIp("203.0.113.3"), "feedback");
    }

    const sameIpOtherBucket = checkRateLimit(requestForIp("203.0.113.3"), "checkout");
    const otherIpSameBucket = checkRateLimit(requestForIp("203.0.113.4"), "feedback");

    expect(sameIpOtherBucket.allowed).toBe(true);
    expect(otherIpSameBucket.allowed).toBe(true);
  });
});
