/**
 * Organization seat orchestration: pending invitations must consume capacity,
 * while a downgrade must preserve existing members and refuse only new seats.
 * Without these tests, checking member rows alone would let an organization
 * reserve an arbitrary number of acceptance links beyond its paid limit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  countOrganizationSeatUsage:
    vi.fn<typeof import("@/models/organization").countOrganizationSeatUsage>(),
  setOrganizationMemberLimitOverride:
    vi.fn<
      typeof import("@/models/organization").setOrganizationMemberLimitOverride
    >(),
  withOrganizationSeatLock:
    vi.fn<typeof import("@/models/organization").withOrganizationSeatLock>(),
  enforceLimit: vi.fn<typeof import("@/services/entitlements").enforceLimit>(),
  resolveLimit: vi.fn<typeof import("@/services/entitlements").resolveLimit>(),
}));

vi.mock("@/models/organization", () => ({
  countOrganizationSeatUsage: mocks.countOrganizationSeatUsage,
  setOrganizationMemberLimitOverride: mocks.setOrganizationMemberLimitOverride,
  withOrganizationSeatLock: mocks.withOrganizationSeatLock,
}));

vi.mock("@/services/entitlements", () => ({
  enforceLimit: mocks.enforceLimit,
  resolveLimit: mocks.resolveLimit,
}));

import {
  assertOrganizationCanAcceptInvitation,
  assertOrganizationCanInvite,
  clearOrganizationSeatLimitOverride,
  getOrganizationSeatSummary,
  saveOrganizationSeatLimitOverride,
} from "@/services/organization-seats";

const ORG_UUID = "org-uuid" as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.countOrganizationSeatUsage.mockResolvedValue({
    members: 3,
    pendingInvitations: 1,
  });
  mocks.resolveLimit.mockResolvedValue({
    tier: "plus",
    defaultValue: 5,
    effectiveValue: 5,
    override: null,
  });
  mocks.enforceLimit.mockResolvedValue();
  mocks.setOrganizationMemberLimitOverride.mockResolvedValue({} as never);
  mocks.withOrganizationSeatLock.mockImplementation(async (_orgId, work) =>
    work(),
  );
});

describe("organization seat capacity", () => {
  it("reserves pending invitations when checking a new invitation", async () => {
    await assertOrganizationCanInvite("org-id", ORG_UUID);

    expect(mocks.enforceLimit).toHaveBeenCalledWith(
      ORG_UUID,
      "organization.members",
      { current: 4, adding: 1 },
    );
  });

  it("excludes the invitation being replaced from capacity", async () => {
    await assertOrganizationCanInvite("org-id", ORG_UUID, {
      replacingEmail: "VIP@Example.com",
    });

    expect(mocks.countOrganizationSeatUsage).toHaveBeenCalledWith("org-id", {
      excludePendingEmail: "VIP@Example.com",
    });
  });

  it("rechecks accepted members after a downgrade without counting the link twice", async () => {
    await assertOrganizationCanAcceptInvitation("org-id", ORG_UUID);

    // The pending invitation already owns the seat it is about to become.
    // Acceptance asks whether one more member fits under the *current* plan.
    expect(mocks.enforceLimit).toHaveBeenCalledWith(
      ORG_UUID,
      "organization.members",
      { current: 3, adding: 1 },
    );
  });

  it("reports an over-limit downgrade without removing anyone", async () => {
    mocks.resolveLimit.mockResolvedValue({
      tier: "free",
      defaultValue: 1,
      effectiveValue: 1,
      override: null,
    });

    const summary = await getOrganizationSeatSummary("org-id", ORG_UUID);

    expect(summary).toMatchObject({
      planLimit: 1,
      effectiveLimit: 1,
      members: 3,
      pendingInvitations: 1,
      occupied: 4,
      available: 0,
      overLimit: true,
    });
    expect(mocks.setOrganizationMemberLimitOverride).not.toHaveBeenCalled();
  });
});

describe("admin seat exceptions", () => {
  it("saves a VIP limit independently from the plan", async () => {
    mocks.resolveLimit.mockResolvedValue({
      tier: "max",
      defaultValue: 20,
      effectiveValue: 35,
      override: { value: 35, expiresAt: null, active: true },
    });

    const summary = await saveOrganizationSeatLimitOverride({
      orgId: "org-id",
      orgUuid: ORG_UUID,
      limit: 35,
      expiresAt: null,
    });

    expect(mocks.setOrganizationMemberLimitOverride).toHaveBeenCalledWith(
      ORG_UUID,
      35,
      null,
    );
    expect(summary).toMatchObject({
      planLimit: 20,
      effectiveLimit: 35,
      override: { limit: 35, active: true },
    });
  });

  it("rejects an invalid limit before touching the organization", async () => {
    await expect(
      saveOrganizationSeatLimitOverride({
        orgId: "org-id",
        orgUuid: ORG_UUID,
        limit: 0,
        expiresAt: null,
      }),
    ).rejects.toMatchObject({
      code: "REQUEST_VALIDATION_FAILED",
      details: { field: "limit" },
    });
    expect(mocks.setOrganizationMemberLimitOverride).not.toHaveBeenCalled();
  });

  it("resetting an override immediately restores the plan path", async () => {
    const summary = await clearOrganizationSeatLimitOverride({
      orgId: "org-id",
      orgUuid: ORG_UUID,
    });

    expect(mocks.setOrganizationMemberLimitOverride).toHaveBeenCalledWith(
      ORG_UUID,
      null,
      null,
    );
    expect(summary.effectiveLimit).toBe(5);
  });
});
