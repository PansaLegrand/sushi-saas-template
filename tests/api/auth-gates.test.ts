import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";
import { postJson } from "../helpers/request";

const mocks = vi.hoisted(() => ({
  getUserUuid: vi.fn(),
  getUserProfileByUuid: vi.fn(),
  getOrgCreditSummary: vi.fn(),
  getOrgContext: vi.fn(),
}));

vi.mock("@/services/user", () => ({
  getUserUuid: mocks.getUserUuid,
  getUserProfileByUuid: mocks.getUserProfileByUuid,
}));

// This file is about the signed-out case, so the context resolver is a
// controllable mock rather than a fixed value: returning null is the whole
// point of most of these tests.
vi.mock("@/services/authz", () => ({
  getOrgContext: mocks.getOrgContext,
  getOrgContextFromHeaders: mocks.getOrgContext,
  can: () => true,
}));


vi.mock("@/services/credit", () => ({
  getOrgCreditSummary: mocks.getOrgCreditSummary,
}));

import { POST as getAccountProfile } from "@/app/api/account/profile/route";
import { POST as getAccountCredits } from "@/app/api/account/credits/route";

describe("public account auth gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitForTests();
    mocks.getUserUuid.mockResolvedValue(null);
    // Signed out: no session, therefore no organization to act in.
    mocks.getOrgContext.mockResolvedValue(null);
  });

  it("rejects profile requests without loading profile data", async () => {
    const res = await getAccountProfile(postJson("/api/account/profile"));
    const payload = await res.json();

    expect(res.status).toBe(401);
    expect(payload.code).toBe(-2);
    expect(mocks.getUserProfileByUuid).not.toHaveBeenCalled();
  });

  it("rejects credit summary requests without loading ledger data", async () => {
    const res = await getAccountCredits(postJson("/api/account/credits"));
    const payload = await res.json();

    expect(res.status).toBe(401);
    expect(payload.code).toBe(-2);
    expect(mocks.getOrgCreditSummary).not.toHaveBeenCalled();
  });
});
