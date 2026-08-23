import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRetentionPolicy: vi.fn(),
  countRetentionCandidates: vi.fn(),
  deleteFinishedJobsBefore: vi.fn(),
  deleteMarketingProviderEventsBefore: vi.fn(),
  deleteAuthEventsBefore: vi.fn(),
  deleteAdminAuditLogsBefore: vi.fn(),
}));

vi.mock("@/config/retention", () => ({
  getRetentionPolicy: mocks.getRetentionPolicy,
}));
vi.mock("@/models/job", () => ({
  deleteFinishedJobsBefore: mocks.deleteFinishedJobsBefore,
}));
vi.mock("@/models/marketing", () => ({
  deleteMarketingProviderEventsBefore:
    mocks.deleteMarketingProviderEventsBefore,
}));
vi.mock("@/models/retention", () => ({
  countRetentionCandidates: mocks.countRetentionCandidates,
  deleteAuthEventsBefore: mocks.deleteAuthEventsBefore,
  deleteAdminAuditLogsBefore: mocks.deleteAdminAuditLogsBefore,
}));

import {
  applyRetentionPolicy,
  getRetentionReport,
  retentionCutoffs,
} from "@/services/retention";

const policy = {
  finishedJobsDays: 14,
  marketingProviderEventsDays: 30,
  authEventsDays: 90,
  adminAuditLogsDays: 365,
};
const now = new Date("2026-08-23T12:00:00.000Z");

describe("operational retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRetentionPolicy.mockReturnValue(policy);
    mocks.countRetentionCandidates.mockResolvedValue({
      finishedJobs: { count: 2 },
    });
    mocks.deleteFinishedJobsBefore.mockResolvedValue(1);
    mocks.deleteMarketingProviderEventsBefore.mockResolvedValue(2);
    mocks.deleteAuthEventsBefore.mockResolvedValue(3);
    mocks.deleteAdminAuditLogsBefore.mockResolvedValue(4);
  });

  it("derives every cutoff from one consistent instant", () => {
    const cutoffs = retentionCutoffs(policy, now);
    expect(cutoffs.finishedJobs.toISOString()).toBe("2026-08-09T12:00:00.000Z");
    expect(cutoffs.marketingProviderEvents.toISOString()).toBe(
      "2026-07-24T12:00:00.000Z",
    );
    expect(cutoffs.authEvents.toISOString()).toBe("2026-05-25T12:00:00.000Z");
    expect(cutoffs.adminAuditLogs.toISOString()).toBe(
      "2025-08-23T12:00:00.000Z",
    );
  });

  it("reports candidates without deleting anything", async () => {
    const report = await getRetentionReport(now);
    expect(report.policy).toEqual(policy);
    expect(mocks.countRetentionCandidates).toHaveBeenCalledWith(report.cutoffs);
    expect(mocks.deleteAuthEventsBefore).not.toHaveBeenCalled();
  });

  it("applies only the four operational datasets", async () => {
    const result = await applyRetentionPolicy(now);
    expect(result.deleted).toEqual({
      finishedJobs: 1,
      marketingProviderEvents: 2,
      authEvents: 3,
      adminAuditLogs: 4,
    });
  });
});
