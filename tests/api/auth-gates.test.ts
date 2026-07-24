import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";
import { postJson } from "../helpers/request";

const mocks = vi.hoisted(() => ({
  getUserUuid: vi.fn(),
  getUserProfileByUuid: vi.fn(),
  getUserCreditSummary: vi.fn(),
}));

vi.mock("@/services/user", () => ({
  getUserUuid: mocks.getUserUuid,
  getUserProfileByUuid: mocks.getUserProfileByUuid,
}));

vi.mock("@/services/credit", () => ({
  getUserCreditSummary: mocks.getUserCreditSummary,
}));

import { POST as getAccountProfile } from "@/app/api/account/profile/route";
import { POST as getAccountCredits } from "@/app/api/account/credits/route";

describe("public account auth gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitForTests();
    mocks.getUserUuid.mockResolvedValue(null);
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
    expect(mocks.getUserCreditSummary).not.toHaveBeenCalled();
  });
});
