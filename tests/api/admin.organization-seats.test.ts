/**
 * Admin organization seat overrides change authorization without changing
 * billing. These route tests pin the write gate, validation, organization
 * scope, and append-only audit trail so a support exception cannot become an
 * unaudited public entitlement endpoint.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCacheForTests } from "@/lib/env";
import { resetRateLimitForTests } from "@/lib/rate-limit";
import { respForbidden, respNoAuth } from "@/lib/resp";

const mocks = vi.hoisted(() => ({
  requireAdminWrite: vi.fn(),
  writeAdminAuditLog: vi.fn(),
  findOrganizationByUuid:
    vi.fn<typeof import("@/models/organization").findOrganizationByUuid>(),
  saveOrganizationSeatLimitOverride:
    vi.fn<
      typeof import("@/services/organization-seats").saveOrganizationSeatLimitOverride
    >(),
  clearOrganizationSeatLimitOverride:
    vi.fn<
      typeof import("@/services/organization-seats").clearOrganizationSeatLimitOverride
    >(),
}));

vi.mock("@admin/lib/authz", () => ({
  requireAdminWrite: mocks.requireAdminWrite,
}));

vi.mock("@admin/lib/audit", () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}));

vi.mock("@/models/organization", () => ({
  asOrgUuid: (value: string) => value,
  findOrganizationByUuid: mocks.findOrganizationByUuid,
  withOrganizationSeatLock: (_orgId: string, work: () => Promise<unknown>) =>
    work(),
}));

vi.mock("@/services/organization-seats", async () => {
  const actual = await vi.importActual<
    typeof import("@/services/organization-seats")
  >("@/services/organization-seats");
  return {
    ...actual,
    saveOrganizationSeatLimitOverride: mocks.saveOrganizationSeatLimitOverride,
    clearOrganizationSeatLimitOverride:
      mocks.clearOrganizationSeatLimitOverride,
  };
});

import {
  DELETE as resetSeatLimit,
  POST as saveSeatLimit,
} from "@admin/app/api/admin/organizations/[uuid]/seat-limit/route";

const writeAdmin = {
  userId: "admin-id",
  userUuid: "admin-uuid",
  email: "admin@example.com",
  role: "admin_rw" as const,
};

const organization = {
  id: "org-id",
  uuid: "org-uuid",
  member_limit_override: 20,
  member_limit_override_expires_at: null,
};

const summary = {
  planLimit: 20,
  effectiveLimit: 35,
  override: { limit: 35, expiresAt: null, active: true },
  members: 12,
  pendingInvitations: 2,
  occupied: 14,
  available: 21,
  overLimit: false,
};

const route = { params: Promise.resolve({ uuid: "org-uuid" }) };

function request(method: "POST" | "DELETE", body: unknown) {
  return new Request(
    "http://admin.test/api/admin/organizations/org-uuid/seat-limit",
    {
      method,
      headers: {
        "content-type": "application/json",
        origin: "http://admin.test",
      },
      body: JSON.stringify(body),
    },
  );
}

describe("admin organization seat-limit API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitForTests();
    resetEnvCacheForTests();
    mocks.requireAdminWrite.mockResolvedValue(writeAdmin);
    mocks.findOrganizationByUuid.mockResolvedValue(organization as never);
    mocks.saveOrganizationSeatLimitOverride.mockResolvedValue(summary);
    mocks.clearOrganizationSeatLimitOverride.mockResolvedValue({
      ...summary,
      effectiveLimit: 20,
      override: null,
    });
  });

  it("rejects an unauthenticated write before loading the organization", async () => {
    mocks.requireAdminWrite.mockResolvedValue(respNoAuth());

    const response = await saveSeatLimit(
      request("POST", { limit: 35, note: "VIP agreement" }),
      route,
    );

    expect(response.status).toBe(401);
    expect(mocks.findOrganizationByUuid).not.toHaveBeenCalled();
    expect(mocks.saveOrganizationSeatLimitOverride).not.toHaveBeenCalled();
  });

  it("rejects a read-only admin before changing entitlement state", async () => {
    mocks.requireAdminWrite.mockResolvedValue(respForbidden());

    const response = await saveSeatLimit(
      request("POST", { limit: 35, note: "VIP agreement" }),
      route,
    );

    expect(response.status).toBe(403);
    expect(mocks.saveOrganizationSeatLimitOverride).not.toHaveBeenCalled();
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled();
  });

  it("sets a VIP exception and records its previous value", async () => {
    const response = await saveSeatLimit(
      request("POST", { limit: 35, note: "VIP agreement" }),
      route,
    );

    expect(response.status).toBe(200);
    expect(mocks.saveOrganizationSeatLimitOverride).toHaveBeenCalledWith({
      orgId: "org-id",
      orgUuid: "org-uuid",
      limit: 35,
      expiresAt: null,
    });
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: writeAdmin,
        action: "organization.seat_limit.override",
        targetType: "organization",
        targetUuid: "org-uuid",
        note: "VIP agreement",
        metadata: expect.objectContaining({
          previousLimit: 20,
          limit: 35,
        }),
      }),
    );
  });

  it("rejects an expired exception before changing the current one", async () => {
    const response = await saveSeatLimit(
      request("POST", {
        limit: 35,
        expiresAt: "2020-01-01T00:00:00.000Z",
        note: "VIP agreement",
      }),
      route,
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.details).toMatchObject({ field: "expiresAt" });
    expect(mocks.saveOrganizationSeatLimitOverride).not.toHaveBeenCalled();
  });

  it("requires an audit reason", async () => {
    const response = await saveSeatLimit(
      request("POST", { limit: 35, note: "" }),
      route,
    );

    expect(response.status).toBe(400);
    expect(mocks.saveOrganizationSeatLimitOverride).not.toHaveBeenCalled();
  });

  it("resets to the live plan and audits the downgrade", async () => {
    const response = await resetSeatLimit(
      request("DELETE", { note: "VIP agreement ended" }),
      route,
    );

    expect(response.status).toBe(200);
    expect(mocks.clearOrganizationSeatLimitOverride).toHaveBeenCalledWith({
      orgId: "org-id",
      orgUuid: "org-uuid",
    });
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "organization.seat_limit.reset",
        note: "VIP agreement ended",
        metadata: expect.objectContaining({ planLimit: 20 }),
      }),
    );
  });
});
