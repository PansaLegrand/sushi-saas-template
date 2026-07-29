import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getReadinessReport:
    vi.fn<typeof import("@/services/readiness").getReadinessReport>(),
}));

vi.mock("@/services/readiness", () => ({
  getReadinessReport: mocks.getReadinessReport,
}));

import { GET } from "@/app/api/ready/route";

describe("GET /api/ready", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getReadinessReport.mockResolvedValue({
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

  it("returns 200 only while required dependencies are ready", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      ready: true,
    });
  });

  it("returns 503 for a dependency failure", async () => {
    mocks.getReadinessReport.mockResolvedValueOnce({
      ready: false,
      checks: {
        env: "ok",
        database: "ok",
        redis: "error",
        queue: "unknown",
      },
      details: { migrationsApplied: 24 },
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      ready: false,
    });
  });
});
