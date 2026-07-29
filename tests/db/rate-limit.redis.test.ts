import { randomUUID } from "node:crypto";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetEnvCacheForTests } from "@/lib/env";
import {
  checkRateLimit,
  closeRateLimitStoreForTests,
} from "@/lib/rate-limit";

const redisUrl = process.env.TEST_REDIS_URL?.trim() ?? "";
const hasTestRedis = Boolean(redisUrl);

// An absent local service may skip this infrastructure test. CI may not: a
// missing URL there would silently remove the only test that talks to Redis.
if (!hasTestRedis && process.env.CI) {
  throw new Error(
    "TEST_REDIS_URL is not set in CI. The real Redis rate-limit test must not be skipped."
  );
}

const describeRedis = describe.skipIf(!hasTestRedis);

describeRedis("rate limiter with real Redis", () => {
  const previousRateLimitUrl = process.env.RATE_LIMIT_REDIS_URL;
  const ip = `redis-test-${randomUUID()}`;
  const redisKey = `rate_limit:feedback:${ip}`;
  const observer = createClient({ url: redisUrl });

  beforeAll(async () => {
    observer.on("error", () => undefined);
    await observer.connect();

    process.env.RATE_LIMIT_REDIS_URL = redisUrl;
    resetEnvCacheForTests();
    await closeRateLimitStoreForTests();
  });

  afterAll(async () => {
    await closeRateLimitStoreForTests();
    await observer.del(redisKey);
    await observer.close();

    if (previousRateLimitUrl === undefined) {
      delete process.env.RATE_LIMIT_REDIS_URL;
    } else {
      process.env.RATE_LIMIT_REDIS_URL = previousRateLimitUrl;
    }
    resetEnvCacheForTests();
  });

  it("keeps one atomic counter across Redis client instances", async () => {
    const request = new Request("http://test/api/feedback", {
      headers: { "x-forwarded-for": ip },
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await checkRateLimit(request, "feedback")).allowed).toBe(true);
    }

    // Simulate a new server process. The in-process store and client are gone,
    // while the shared Redis key must retain the first three increments.
    await closeRateLimitStoreForTests();

    const fourth = await checkRateLimit(request, "feedback");
    const fifth = await checkRateLimit(request, "feedback");
    const sixth = await checkRateLimit(request, "feedback");

    expect(fourth.allowed).toBe(true);
    expect(fifth.allowed).toBe(true);
    expect(sixth.allowed).toBe(false);
    if (!sixth.allowed) {
      expect(sixth.response.status).toBe(429);
      await expect(sixth.response.json()).resolves.toMatchObject({
        error_code: "REQUEST_RATE_LIMITED",
      });
    }

    await expect(observer.get(redisKey)).resolves.toBe("6");
    const ttlMs = await observer.pTTL(redisKey);
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(60_000);
  });
});
