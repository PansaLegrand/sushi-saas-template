/**
 * The admin plan endpoint: reading a user's entitlements, and comping them.
 *
 * Two properties matter here and neither is visible in a type check. A
 * read-only admin must not be able to change what anyone is entitled to, and a
 * comp must leave an audit entry — a tier handed out with no record of who
 * handed it out is indistinguishable from a bug in the billing sync.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { respForbidden, respNoAuth } from "@/lib/resp";

const mocks = vi.hoisted(() => ({
  requireAdminRead: vi.fn(),
  requireAdminWrite: vi.fn(),
  writeAdminAuditLog: vi.fn(),
  findUserByUuid: vi.fn(),
  getPlanSnapshot: vi.fn(),
  grantManualSubscription: vi.fn(),
  revokeManualSubscriptions: vi.fn(),
}));

vi.mock("@admin/lib/authz", () => ({
  requireAdminRead: mocks.requireAdminRead,
  requireAdminWrite: mocks.requireAdminWrite,
}));

vi.mock("@admin/lib/origin", () => ({
  requireSameOrigin: () => undefined,
}));

vi.mock("@admin/lib/audit", () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}));

vi.mock("@/models/user", () => ({
  findUserByUuid: mocks.findUserByUuid,
}));

vi.mock("@/services/entitlements", () => ({
  getPlanSnapshot: mocks.getPlanSnapshot,
}));

vi.mock("@/services/subscriptions", () => ({
  grantManualSubscription: mocks.grantManualSubscription,
  revokeManualSubscriptions: mocks.revokeManualSubscriptions,
}));

import {
  DELETE as revokePlan,
  GET as readPlan,
  POST as compPlan,
} from "@admin/app/api/admin/users/[uuid]/plan/route";

const params = (uuid: string) => ({ params: Promise.resolve({ uuid }) });

const readOnlyAdmin = {
  userId: "id-admin",
  userUuid: "u-admin",
  email: "admin@example.com",
  role: "admin_ro" as const,
};

const writeAdmin = { ...readOnlyAdmin, role: "admin_rw" as const };

function compRequest(body: unknown) {
  return new Request("http://admin.test/api/admin/users/u-1/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin user plan API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRead.mockResolvedValue(readOnlyAdmin);
    mocks.requireAdminWrite.mockResolvedValue(writeAdmin);
    mocks.findUserByUuid.mockResolvedValue({ uuid: "u-1", email: "user@example.com" });
    mocks.getPlanSnapshot.mockResolvedValue({ tier: "max", name: "Max" });
    mocks.grantManualSubscription.mockResolvedValue({ status: "granted", row: {} });
    mocks.revokeManualSubscriptions.mockResolvedValue(1);
  });

  it("refuses to read a plan before the admin gate passes", async () => {
    mocks.requireAdminRead.mockResolvedValue(respNoAuth());

    const res = await readPlan(new Request("http://admin.test"), params("u-1"));

    expect(res.status).toBe(401);
    expect(mocks.getPlanSnapshot).not.toHaveBeenCalled();
  });

  it("reports an unknown user rather than a free-plan snapshot", async () => {
    // A zeroed snapshot for a mistyped uuid reads exactly like a real user on
    // the free tier, which is how an admin ends up comping the wrong account.
    mocks.findUserByUuid.mockResolvedValue(undefined);

    const res = await readPlan(new Request("http://admin.test"), params("nope"));
    const payload = await res.json();

    expect(res.status).toBe(404);
    expect(payload.error_code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("refuses a comp from a read-only admin", async () => {
    mocks.requireAdminWrite.mockResolvedValue(respForbidden());

    const res = await compPlan(compRequest({ tier: "max" }), params("u-1"));

    expect(res.status).toBe(403);
    expect(mocks.grantManualSubscription).not.toHaveBeenCalled();
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled();
  });

  it("replaces any existing comp so revocation stays unambiguous", async () => {
    const res = await compPlan(
      compRequest({ tier: "max", note: "design partner" }),
      params("u-1")
    );

    expect(res.status).toBe(200);
    expect(mocks.revokeManualSubscriptions).toHaveBeenCalledWith("u-1");
    expect(mocks.grantManualSubscription).toHaveBeenCalledWith({
      userUuid: "u-1",
      tier: "max",
      expiresAt: null,
      note: "design partner",
    });
  });

  it("records who comped whom", async () => {
    await compPlan(compRequest({ tier: "plus", note: "apology" }), params("u-1"));

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: writeAdmin,
        action: "plan.comp.grant",
        targetType: "user",
        targetUuid: "u-1",
        note: "apology",
        metadata: expect.objectContaining({ tier: "plus" }),
      })
    );
  });

  it("rejects a tier that is not in the catalog", async () => {
    mocks.grantManualSubscription.mockResolvedValue({ status: "invalid-tier" });

    const res = await compPlan(compRequest({ tier: "enterprise" }), params("u-1"));
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload.details).toMatchObject({ field: "tier" });
  });

  it("rejects an unparseable expiry rather than comping indefinitely", async () => {
    // The dangerous default: a bad date silently becoming null is a permanent
    // free upgrade nobody intended.
    const res = await compPlan(
      compRequest({ tier: "max", expiresAt: "not-a-date" }),
      params("u-1")
    );

    expect(res.status).toBe(400);
    expect(mocks.grantManualSubscription).not.toHaveBeenCalled();
  });

  it("revokes comps and reports the resulting plan", async () => {
    const res = await revokePlan(
      new Request("http://admin.test", { method: "DELETE" }),
      params("u-1")
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.data.revoked).toBe(1);
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "plan.comp.revoke" })
    );
  });

  it("writes no audit entry when there was nothing to revoke", async () => {
    mocks.revokeManualSubscriptions.mockResolvedValue(0);

    await revokePlan(
      new Request("http://admin.test", { method: "DELETE" }),
      params("u-1")
    );

    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled();
  });
});
