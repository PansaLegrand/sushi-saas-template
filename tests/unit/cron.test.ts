/**
 * Cron endpoints are public URLs, so the shared-secret guard is the only thing
 * stopping anyone from triggering them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireCronAuth } from "@/lib/cron";
import { resetEnvCacheForTests } from "@/lib/env";

const STRONG_CRON_SECRET = "9Nz3wQ6fH1kM8rV4tY7pC2xD5jL0sBaE";

function buildRequest(authorization?: string) {
  return new Request("https://app.example.com/api/cron/jobs", {
    headers: authorization ? { authorization } : {},
  });
}

describe("requireCronAuth", () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
    resetEnvCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.CRON_SECRET;
    resetEnvCacheForTests();
  });

  it("allows the matching bearer token", () => {
    process.env.CRON_SECRET = "s3cret";
    resetEnvCacheForTests();

    expect(requireCronAuth(buildRequest("Bearer s3cret"))).toBeNull();
  });

  it("rejects a wrong token", () => {
    process.env.CRON_SECRET = "s3cret";
    resetEnvCacheForTests();

    expect(requireCronAuth(buildRequest("Bearer nope"))?.status).toBe(401);
  });

  it("rejects a same-length wrong token", () => {
    process.env.CRON_SECRET = "s3cret";
    resetEnvCacheForTests();

    expect(requireCronAuth(buildRequest("Bearer s3cRet"))?.status).toBe(401);
  });

  it("rejects a missing authorization header", () => {
    process.env.CRON_SECRET = "s3cret";
    resetEnvCacheForTests();

    expect(requireCronAuth(buildRequest())?.status).toBe(401);
  });

  it("rejects a token that is merely a prefix", () => {
    process.env.CRON_SECRET = "s3cret";
    resetEnvCacheForTests();

    expect(requireCronAuth(buildRequest("Bearer s3cre"))?.status).toBe(401);
  });

  it("allows unauthenticated calls outside production for local testing", () => {
    // NODE_ENV is "test" here, so isProductionRuntime() is false.
    expect(requireCronAuth(buildRequest())).toBeNull();
  });

  it("fails closed in production when no secret is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.npm_lifecycle_event;
    resetEnvCacheForTests();

    expect(requireCronAuth(buildRequest())?.status).toBe(403);
  });

  it("fails closed in production when the configured secret is weak", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.npm_lifecycle_event;
    process.env.CRON_SECRET = "cron-secret";
    resetEnvCacheForTests();

    expect(requireCronAuth(buildRequest("Bearer cron-secret"))?.status).toBe(
      403,
    );
  });

  it("accepts a strong production secret and returns catalog errors", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.npm_lifecycle_event;
    process.env.CRON_SECRET = STRONG_CRON_SECRET;
    resetEnvCacheForTests();

    expect(
      requireCronAuth(buildRequest(`Bearer ${STRONG_CRON_SECRET}`)),
    ).toBeNull();

    const response = requireCronAuth(buildRequest("Bearer wrong"));
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      error_code: "AUTH_REQUIRED",
    });
  });
});
