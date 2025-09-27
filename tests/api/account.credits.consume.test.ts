/**
 * Integration tests for the "consume credits" API.
 *
 * What we test
 * - Happy path: the route accepts a POST body like `{ credits: 1 }`,
 *   calls the credit service to record a negative transaction, and
 *   returns the new balance in a unified `{ code, message, data }` JSON.
 * - Validation: sending a non‑positive amount returns a 400 with error code.
 *
 * How these tests run
 * - We import the Next.js route's `POST` handler directly and call it with
 *   a `new Request()` — no HTTP server or browser is started.
 * - We mock auth to always return a fixed user UUID and mock the
 *   `@/services/credit` functions so no database access is performed.
 *
 * Test data
 * - User UUID: "u-test"
 * - Consume request: `{ credits: 1 }`
 * - Mocked summary after consume: `{ balance: 4, granted: 5, consumed: 1, ... }`
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks first: fake the current user and credit service
vi.mock("@/services/user", () => ({
  getUserUuid: vi.fn().mockResolvedValue("u-test"),
}));

vi.mock("@/services/credit", () => ({
  CreditsTransType: { MockUsage: "mock_usage" },
  decreaseCredits: vi.fn().mockResolvedValue(undefined),
  getUserCreditSummary: vi
    .fn()
    .mockResolvedValue({
      balance: 4,
      granted: 5,
      consumed: 1,
      expired: 0,
      expiringSoon: [],
      ledger: [],
    }),
}));

// Route after mocks: import the handler we are testing
import { POST as consumeCredits } from "@/app/api/account/credits/consume/route";

describe("POST /api/account/credits/consume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("consumes credits and returns new balance", async () => {
    const req = new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credits: 1 }),
    });

    const res = await consumeCredits(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.code).toBe(0);
    expect(payload.data.balance).toBe(4);
    // Verify the service was called with our user UUID and amount
    const credit = await import("@/services/credit");
    expect(credit.decreaseCredits).toHaveBeenCalledWith({
      user_uuid: "u-test",
      trans_type: "mock_usage",
      credits: 1,
    });
  });

  it("errors for non-positive amount", async () => {
    const req = new Request("http://test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credits: 0 }) });
    const res = await consumeCredits(req);
    expect(res.status).toBe(400);
  });
});
