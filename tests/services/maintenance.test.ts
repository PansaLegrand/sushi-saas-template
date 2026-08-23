import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pruneFinishedJobs: vi.fn(),
  pruneMarketingProviderEvents: vi.fn(),
  cleanupStaleUploads: vi.fn(),
  sweepStripeWebhookEvents: vi.fn(),
}));

vi.mock("@/services/jobs", () => ({
  pruneFinishedJobs: mocks.pruneFinishedJobs,
}));
vi.mock("@/services/marketing/operations", () => ({
  pruneMarketingProviderEvents: mocks.pruneMarketingProviderEvents,
}));
vi.mock("@/services/storage/cleanup", () => ({
  cleanupStaleUploads: mocks.cleanupStaleUploads,
}));
vi.mock("@/services/stripe/sweep", () => ({
  sweepStripeWebhookEvents: mocks.sweepStripeWebhookEvents,
}));

import { runOperationalMaintenance } from "@/services/maintenance";

describe("operational maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pruneFinishedJobs.mockResolvedValue(3);
    mocks.pruneMarketingProviderEvents.mockResolvedValue(4);
    mocks.cleanupStaleUploads.mockResolvedValue(2);
    mocks.sweepStripeWebhookEvents.mockResolvedValue({ stuck: 1 });
  });

  it("keeps cron and portable workers on the same maintenance path", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const result = await runOperationalMaintenance(now);

    expect(mocks.pruneFinishedJobs).toHaveBeenCalledWith(now);
    expect(mocks.pruneMarketingProviderEvents).toHaveBeenCalledWith(now);
    expect(mocks.cleanupStaleUploads).toHaveBeenCalledWith({ now });
    expect(mocks.sweepStripeWebhookEvents).toHaveBeenCalledWith(now);
    expect(result).toEqual({
      finishedJobsPruned: 3,
      marketingProviderEventsPruned: 4,
      staleUploadsFailed: 2,
      stripe: { stuck: 1 },
    });
  });
});
