/**
 * Integration tests for the "grant credits" API.
 *
 * What we test
 * - Happy path: accepts `{ credits: 5 }`, records a positive ledger entry,
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

// Define mocks BEFORE importing the route under test
vi.mock("@/services/user", () => ({
  getUserUuid: vi.fn().mockResolvedValue("u-test"),
}));

vi.mock("@/services/credit", () => ({
  CreditsTransType: { SystemAdd: "system_add" },
  increaseCredits: vi.fn().mockResolvedValue(undefined),
  getUserCreditSummary: vi
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
  });

  it("grants credits and returns summary", async () => {
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
      user_uuid: "u-test",
      trans_type: "system_add",
      credits: 5,
      expired_at: undefined,
      order_no: undefined,
    });
    expect(credit.getUserCreditSummary).toHaveBeenCalledWith(
      "u-test",
      expect.any(Object)
    );
    expect(payload.data.balance).toBe(5);
  });

  it("rejects invalid amounts", async () => {
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
