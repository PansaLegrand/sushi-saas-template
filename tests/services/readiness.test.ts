import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validateAppEnv: vi.fn(),
  checkDatabaseReadiness:
    vi.fn<typeof import("@/models/readiness").checkDatabaseReadiness>(),
  checkRateLimitStoreReady:
    vi.fn<typeof import("@/lib/rate-limit").checkRateLimitStoreReady>(),
  getJobQueueReadiness:
    vi.fn<typeof import("@/models/job").getJobQueueReadiness>(),
}));

vi.mock("@/lib/env", () => ({
  validateAppEnv: mocks.validateAppEnv,
}));

vi.mock("@/models/readiness", () => ({
  checkDatabaseReadiness: mocks.checkDatabaseReadiness,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitStoreReady: mocks.checkRateLimitStoreReady,
}));

vi.mock("@/models/job", () => ({
  getJobQueueReadiness: mocks.getJobQueueReadiness,
}));

import { getReadinessReport } from "@/services/readiness";

describe("getReadinessReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkDatabaseReadiness.mockResolvedValue({ migrationsApplied: 24 });
    mocks.checkRateLimitStoreReady.mockResolvedValue({ distributed: true });
    mocks.getJobQueueReadiness.mockResolvedValue({
      pending: 0,
      running: 0,
      failed: 0,
      staleRunning: 0,
    });
  });

  it("reports ready when required dependencies respond", async () => {
    await expect(getReadinessReport()).resolves.toMatchObject({
      ready: true,
      checks: {
        env: "ok",
        database: "ok",
        redis: "ok",
        queue: "ok",
      },
      details: {
        migrationsApplied: 24,
        distributedRateLimit: true,
      },
    });
  });

  it("fails readiness without exposing dependency errors", async () => {
    mocks.checkRateLimitStoreReady.mockRejectedValueOnce(
      new Error("redis://user:secret@internal")
    );

    const report = await getReadinessReport();

    expect(report.ready).toBe(false);
    expect(report.checks.redis).toBe("error");
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("surfaces failed jobs as degradation without taking web traffic down", async () => {
    mocks.getJobQueueReadiness.mockResolvedValueOnce({
      pending: 2,
      running: 0,
      failed: 1,
      staleRunning: 0,
    });

    const report = await getReadinessReport();

    expect(report.ready).toBe(true);
    expect(report.checks.queue).toBe("degraded");
  });
});
