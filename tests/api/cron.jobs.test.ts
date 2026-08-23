import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCronAuth: vi.fn(),
  runDueJobs: vi.fn(),
  runOperationalMaintenance: vi.fn(),
  countJobsByStatus: vi.fn(),
}));

vi.mock("@/lib/cron", () => ({ requireCronAuth: mocks.requireCronAuth }));
vi.mock("@/services/jobs", () => ({ runDueJobs: mocks.runDueJobs }));
vi.mock("@/services/maintenance", () => ({
  runOperationalMaintenance: mocks.runOperationalMaintenance,
}));
vi.mock("@/models/job", () => ({
  countJobsByStatus: mocks.countJobsByStatus,
}));
vi.mock("@/lib/logger/server", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { GET } from "@/app/api/cron/jobs/route";

const request = new Request("https://app.example.test/api/cron/jobs");

describe("job cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCronAuth.mockReturnValue(undefined);
    mocks.runDueJobs.mockResolvedValue({
      claimed: 0,
      succeeded: 0,
      retrying: 0,
      failed: 0,
      leaseLost: 0,
      results: [],
    });
    mocks.runOperationalMaintenance.mockResolvedValue({
      finishedJobsPruned: 2,
      marketingProviderEventsPruned: 3,
      staleUploadsFailed: 1,
      stripe: { stuck: 0 },
    });
    mocks.countJobsByStatus.mockResolvedValue({ pending: 0 });
  });

  it("authenticates before touching the queue or maintenance", async () => {
    mocks.requireCronAuth.mockReturnValue(
      Response.json({ error_code: "AUTH_REQUIRED" }, { status: 401 }),
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(mocks.runDueJobs).not.toHaveBeenCalled();
    expect(mocks.runOperationalMaintenance).not.toHaveBeenCalled();
  });

  it("uses the same maintenance service as the portable worker", async () => {
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.runDueJobs).toHaveBeenCalledWith(25);
    expect(mocks.runOperationalMaintenance).toHaveBeenCalledOnce();
    expect(body.data).toMatchObject({
      retention: { finishedJobsPruned: 2 },
      marketing: { providerEventsPruned: 3 },
      storage: { staleUploadsFailed: 1 },
    });
  });

  it("does not claim success when maintenance fails", async () => {
    mocks.runOperationalMaintenance.mockRejectedValueOnce(
      new Error("maintenance unavailable"),
    );

    const response = await GET(request);

    expect(response.status).toBe(500);
    expect(mocks.countJobsByStatus).not.toHaveBeenCalled();
  });
});
