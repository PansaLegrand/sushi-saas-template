/**
 * Integration tests for the admin "grant credits" API.
 *
 * What we test
 * - Authz: read-only admins cannot grant; unauthenticated requests are rejected.
 * - Idempotency: the same key applied twice credits once.
 * - Validation: positive integers only, bounded by ADMIN_MAX_CREDIT_GRANT.
 * - Audit: a successful grant writes exactly one audit entry.
 * - Ledger integrity: a client-supplied orderNo never reaches the ledger.
 *
 * How it works here
 * - The route function is invoked directly with a Request.
 * - Authz, audit, credit service, and user lookups are mocked (no DB access).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetRateLimitForTests } from "@/lib/rate-limit";
import { respForbidden } from "@/lib/resp";

const adminContext = {
  userId: "id-admin",
  userUuid: "u-admin",
  email: "admin@example.com",
  role: "admin_rw" as const,
};

const { requireAdminWrite } = vi.hoisted(() => ({
  requireAdminWrite: vi.fn(),
}));

vi.mock("@admin/lib/authz", () => ({ requireAdminWrite }));

vi.mock("@admin/lib/audit", () => ({
  writeAdminAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/models/user", () => ({
  findUserByUuid: vi
    .fn()
    .mockResolvedValue({ uuid: "u-target", email: "user@example.com" }),
}));

vi.mock("@/models/credit", () => ({
  findCreditByTransNo: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/credit", () => ({
  CreditsTransType: { SystemAdd: "system_add" },
  increaseCredits: vi.fn().mockResolvedValue(undefined),
  getUserCreditSummary: vi.fn().mockResolvedValue({
    balance: 100,
    granted: 100,
    consumed: 0,
    expired: 0,
    expiringSoon: [],
    ledger: [],
  }),
}));

import { POST as grantCredits } from "@admin/app/api/admin/credits/grant/route";

function buildRequest(body: unknown) {
  return new Request("http://admin.test/api/admin/credits/grant", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://admin.test",
    },
    body: JSON.stringify(body),
  });
}

const validBody = {
  userUuid: "u-target",
  credits: 100,
  idempotencyKey: "key-1",
  note: "support goodwill",
};

describe("POST /api/admin/credits/grant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminWrite.mockResolvedValue(adminContext);
    delete process.env.ADMIN_MAX_CREDIT_GRANT;
    resetEnvCacheForTests();
    resetRateLimitForTests();
  });

  it("rejects read-only admins before touching the ledger", async () => {
    requireAdminWrite.mockResolvedValue(respForbidden());

    const res = await grantCredits(buildRequest(validBody));
    const credit = await import("@/services/credit");

    expect(res.status).toBe(403);
    expect(credit.increaseCredits).not.toHaveBeenCalled();
  });

  it("blocks cross-origin requests", async () => {
    const req = new Request("http://admin.test/api/admin/credits/grant", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify(validBody),
    });

    const res = await grantCredits(req);
    const credit = await import("@/services/credit");

    expect(res.status).toBe(403);
    expect(credit.increaseCredits).not.toHaveBeenCalled();
  });

  it("requires an idempotency key", async () => {
    const res = await grantCredits(
      buildRequest({ userUuid: "u-target", credits: 10 })
    );
    const payload = await res.json();
    const credit = await import("@/services/credit");

    expect(payload.error_code).toBe("REQUEST_VALIDATION_FAILED");
    expect(payload.details.fields).toContainEqual(
      expect.objectContaining({ field: "idempotencyKey" })
    );
    expect(credit.increaseCredits).not.toHaveBeenCalled();
  });

  it("rejects non-integer and non-positive amounts", async () => {
    for (const credits of [0, -5, 1.5]) {
      const res = await grantCredits(buildRequest({ ...validBody, credits }));
      const payload = await res.json();
      expect(payload.error_code).toBe("CREDITS_INVALID_AMOUNT");
    }

    const credit = await import("@/services/credit");
    expect(credit.increaseCredits).not.toHaveBeenCalled();
  });

  it("enforces the configured grant ceiling", async () => {
    process.env.ADMIN_MAX_CREDIT_GRANT = "500";
    resetEnvCacheForTests();

    const res = await grantCredits(buildRequest({ ...validBody, credits: 501 }));
    const payload = await res.json();
    const credit = await import("@/services/credit");

    expect(payload.error_code).toBe("CREDITS_GRANT_LIMIT_EXCEEDED");
    expect(payload.details).toEqual({ max: 500 });
    expect(credit.increaseCredits).not.toHaveBeenCalled();
  });

  it("grants credits, writes an audit entry, and ignores client order numbers", async () => {
    const res = await grantCredits(
      buildRequest({ ...validBody, orderNo: "forged-order-123" })
    );
    const payload = await res.json();
    const credit = await import("@/services/credit");
    const audit = await import("@admin/lib/audit");

    expect(payload.code).toBe(0);
    expect(payload.data.replayed).toBe(false);
    expect(credit.increaseCredits).toHaveBeenCalledTimes(1);

    const call = vi.mocked(credit.increaseCredits).mock.calls[0][0];
    expect(call.order_no).toBe("");
    expect(call.credits).toBe(100);
    expect(call.trans_no).toMatch(/^admin_grant_[0-9a-f]{40}$/);

    expect(audit.writeAdminAuditLog).toHaveBeenCalledTimes(1);
    const auditCall = vi.mocked(audit.writeAdminAuditLog).mock.calls[0][0];
    expect(auditCall).toMatchObject({
      action: "credits.grant",
      targetType: "user",
      targetUuid: "u-target",
      note: "support goodwill",
    });
    expect(auditCall.actor.userUuid).toBe("u-admin");
  });

  it("does not double-credit when the same key is replayed", async () => {
    const { findCreditByTransNo } = await import("@/models/credit");
    vi.mocked(findCreditByTransNo).mockResolvedValueOnce({
      trans_no: "existing",
    } as any);

    const res = await grantCredits(buildRequest(validBody));
    const payload = await res.json();
    const credit = await import("@/services/credit");
    const audit = await import("@admin/lib/audit");

    expect(payload.code).toBe(0);
    expect(payload.data.replayed).toBe(true);
    expect(credit.increaseCredits).not.toHaveBeenCalled();
    expect(audit.writeAdminAuditLog).not.toHaveBeenCalled();
  });

  it("treats a concurrent duplicate insert as a replay", async () => {
    const credit = await import("@/services/credit");
    vi.mocked(credit.increaseCredits).mockRejectedValueOnce(
      Object.assign(new Error("duplicate key"), { code: "23505" })
    );

    const res = await grantCredits(buildRequest(validBody));
    const payload = await res.json();

    expect(payload.code).toBe(0);
    expect(payload.data.replayed).toBe(true);
  });

  it("returns 404 for an unknown user", async () => {
    const { findUserByUuid } = await import("@/models/user");
    vi.mocked(findUserByUuid).mockResolvedValueOnce(undefined);

    const res = await grantCredits(buildRequest(validBody));
    const credit = await import("@/services/credit");

    expect(res.status).toBe(404);
    expect(credit.increaseCredits).not.toHaveBeenCalled();
  });

  it("derives different transaction numbers per actor and target", async () => {
    await grantCredits(buildRequest(validBody));
    const credit = await import("@/services/credit");
    const first = vi.mocked(credit.increaseCredits).mock.calls[0][0].trans_no;

    vi.clearAllMocks();
    requireAdminWrite.mockResolvedValue({ ...adminContext, userUuid: "u-other" });
    resetRateLimitForTests();

    await grantCredits(buildRequest(validBody));
    const second = vi.mocked(credit.increaseCredits).mock.calls[0][0].trans_no;

    expect(first).not.toBe(second);
  });
});
