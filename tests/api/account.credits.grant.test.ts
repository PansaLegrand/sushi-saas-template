/**
 * Integration tests for the "grant credits" API.
 *
 * What we test
 * - Safe default: rejects requests unless the demo grant flag is explicitly enabled.
 * - Demo happy path: accepts `{ credits: 5 }`, records a positive ledger entry,
 *   and responds with the updated credit summary.
 * - Validation: rejects non‑positive amounts with status 400.
 *
 * How it works here
 * - We invoke the Next.js route function directly with a Request.
 * - Auth and credit service calls are mocked (no DB access).
 *
 * Test data
 * - User UUID: "u-test"
 * - Request: `{ credits: 5, ledgerLimit: 3 }`
 * - Mocked summary: `{ balance: 5, granted: 5, consumed: 0, ... }`
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetRateLimitForTests } from "@/lib/rate-limit";

// Define mocks BEFORE importing the route under test
vi.mock("@/services/user", () => ({
  getUserUuid: vi.fn().mockResolvedValue("u-test"),
}));

// The routes resolve their tenant through `getOrgContext`, which pulls in the
// real Better Auth instance (and therefore a real database) if left unmocked.
vi.mock("@/services/authz", () => ({
  getOrgContext: vi
    .fn()
    .mockResolvedValue({
      userId: "id-test",
      userUuid: "u-test",
      orgId: "id-org-test",
      orgUuid: "org-test",
      orgSlug: "test-org",
      role: "owner",
    }),
  getOrgContextFromHeaders: vi
    .fn()
    .mockResolvedValue({
      userId: "id-test",
      userUuid: "u-test",
      orgId: "id-org-test",
      orgUuid: "org-test",
      orgSlug: "test-org",
      role: "owner",
    }),
  can: () => true,
}));


vi.mock("@/services/credit", () => ({
  CreditsTransType: { SystemAdd: "system_add" },
  increaseCredits: vi.fn().mockResolvedValue(undefined),
  getOrgCreditSummary: vi
    .fn()
    .mockResolvedValue({
      balance: 5,
      granted: 5,
      consumed: 0,
      expired: 0,
      expiringSoon: [],
      ledger: [],
    }),
}));

// Route under test (import after mocks)
import { POST as grantCredits } from "@/app/api/account/credits/grant/route";

describe("POST /api/account/credits/grant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ENABLE_DEMO_FEATURES;
    delete process.env.ENABLE_ACCOUNT_CREDIT_GRANT;
    resetEnvCacheForTests();
    resetRateLimitForTests();
  });

  it("rejects requests by default", async () => {
    const req = new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credits: 5 }),
    });

    const res = await grantCredits(req);
    const payload = await res.json();
    const credit = await import("@/services/credit");

    expect(res.status).toBe(403);
    expect(payload.code).toBe(-3);
    expect(credit.increaseCredits).not.toHaveBeenCalled();
  });

  it("grants credits and returns summary when demo grant is enabled", async () => {
    process.env.ENABLE_DEMO_FEATURES = "true";
    process.env.ENABLE_ACCOUNT_CREDIT_GRANT = "true";
    resetEnvCacheForTests();

    const req = new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credits: 5, ledgerLimit: 3 }),
    });

    const res = await grantCredits(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.code).toBe(0);
    // Assert that our mocked credit service received the expected call
    const credit = await import("@/services/credit");
    expect(credit.increaseCredits).toHaveBeenCalledWith({
      org_uuid: "org-test",
      user_uuid: "u-test",
      trans_type: "system_add",
      credits: 5,
      expired_at: undefined,
      order_no: undefined,
    });
    expect(credit.getOrgCreditSummary).toHaveBeenCalledWith(
      "org-test",
      expect.any(Object)
    );
    expect(payload.data.balance).toBe(5);
  });

  it("rejects invalid amounts", async () => {
    process.env.ENABLE_DEMO_FEATURES = "true";
    process.env.ENABLE_ACCOUNT_CREDIT_GRANT = "true";
    resetEnvCacheForTests();

    const req = new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credits: 0 }),
    });
    const res = await grantCredits(req);
    const payload = await res.json();
    expect(res.status).toBe(400);
    expect(payload.code).toBe(-1);
  });
});
