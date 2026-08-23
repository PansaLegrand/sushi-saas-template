/**
 * Development fixtures touch authentication, tenancy, credits, and the demo
 * catalog. These tests prove a re-run repairs missing pieces without issuing a
 * second immutable ledger grant, and prove remote databases are refused before
 * any model call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findCreditByTransNo:
    vi.fn<typeof import("@/models/credit").findCreditByTransNo>(),
  insertCredit: vi.fn<typeof import("@/models/credit").insertCredit>(),
  ensureDemoService:
    vi.fn<typeof import("@/models/reservation").ensureDemoService>(),
  findUserByEmailAndProvider:
    vi.fn<typeof import("@/models/user").findUserByEmailAndProvider>(),
  markUserEmailVerified:
    vi.fn<typeof import("@/models/user").markUserEmailVerified>(),
  findMembershipsByUserId:
    vi.fn<typeof import("@/models/organization").findMembershipsByUserId>(),
  createPersonalOrganizationIfAbsent:
    vi.fn<
      typeof import("@/models/organization").createPersonalOrganizationIfAbsent
    >(),
}));

vi.mock("@/models/credit", async () => {
  const actual =
    await vi.importActual<typeof import("@/models/credit")>("@/models/credit");
  return {
    ...actual,
    findCreditByTransNo: mocks.findCreditByTransNo,
    insertCredit: mocks.insertCredit,
  };
});
vi.mock("@/models/reservation", () => ({
  ensureDemoService: mocks.ensureDemoService,
}));
vi.mock("@/models/user", () => ({
  findUserByEmailAndProvider: mocks.findUserByEmailAndProvider,
  markUserEmailVerified: mocks.markUserEmailVerified,
}));
vi.mock("@/models/organization", () => ({
  findMembershipsByUserId: mocks.findMembershipsByUserId,
  createPersonalOrganizationIfAbsent: mocks.createPersonalOrganizationIfAbsent,
}));

import {
  findDevelopmentFixtureUser,
  seedDevelopmentFixtures,
} from "@/services/dev-fixtures";
import { resetEnvCacheForTests } from "@/lib/env";

const user = {
  id: "auth-user",
  uuid: "user-uuid",
  email: "demo@example.test",
  nickname: "Demo User",
  email_verified: true,
} as NonNullable<
  Awaited<ReturnType<typeof import("@/models/user").findUserByEmailAndProvider>>
>;
const organization = {
  uuid: "org-uuid",
  slug: "demo-user-abc",
  is_personal: true,
} as Awaited<
  ReturnType<
    typeof import("@/models/organization").createPersonalOrganizationIfAbsent
  >
>;
const reservationService = { id: 1, slug: "demo-consultation" } as Awaited<
  ReturnType<typeof import("@/models/reservation").ensureDemoService>
>;
const credit = { trans_no: "dev-seed:user-uuid", credits: 1000 } as NonNullable<
  Awaited<ReturnType<typeof import("@/models/credit").findCreditByTransNo>>
>;

describe("development fixtures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://sushi:sushi@localhost:5432/sushi_dev",
    );
    resetEnvCacheForTests();
    mocks.findUserByEmailAndProvider.mockResolvedValue(user);
    mocks.findMembershipsByUserId.mockResolvedValue([
      { organization, member: { role: "owner" } },
    ] as never);
    mocks.ensureDemoService.mockResolvedValue(reservationService);
    mocks.insertCredit.mockResolvedValue(credit);
  });

  it("refuses a remote database before looking up a user", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://user:pass@db.example.com:5432/sushi_dev",
    );
    resetEnvCacheForTests();

    await expect(findDevelopmentFixtureUser(user.email)).rejects.toThrow(
      /loopback sushi_dev/,
    );
    expect(mocks.findUserByEmailAndProvider).not.toHaveBeenCalled();
  });

  it("leaves an existing verified fixture and credit grant unchanged", async () => {
    mocks.findCreditByTransNo.mockResolvedValue(credit);

    const result = await seedDevelopmentFixtures({
      email: user.email,
      credits: 1000,
    });

    expect(result.credit).toBe(credit);
    expect(mocks.markUserEmailVerified).not.toHaveBeenCalled();
    expect(mocks.insertCredit).not.toHaveBeenCalled();
    expect(mocks.findMembershipsByUserId).toHaveBeenCalledWith(user.id);
  });

  it("verifies the user and issues one deterministic grant when missing", async () => {
    const unverified = { ...user, email_verified: false };
    mocks.findUserByEmailAndProvider.mockResolvedValue(unverified);
    mocks.markUserEmailVerified.mockResolvedValue(user);
    mocks.findCreditByTransNo
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(credit);

    const result = await seedDevelopmentFixtures({
      email: user.email,
      credits: 1000,
    });

    expect(result.credit).toBe(credit);
    expect(mocks.markUserEmailVerified).toHaveBeenCalledWith(user.id);
    expect(mocks.insertCredit).toHaveBeenCalledWith(
      expect.objectContaining({
        org_uuid: organization.uuid,
        user_uuid: user.uuid,
        credits: 1000,
        trans_no: "dev-seed:user-uuid",
        actor: "system:dev_seed",
      }),
    );
  });

  it("converges when another seed wins the deterministic credit insert", async () => {
    mocks.findCreditByTransNo
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(credit);
    mocks.insertCredit.mockRejectedValueOnce(new Error("duplicate trans_no"));

    const result = await seedDevelopmentFixtures({
      email: user.email,
      credits: 1000,
    });

    expect(result.credit).toBe(credit);
    expect(mocks.insertCredit).toHaveBeenCalledTimes(1);
  });

  it("produces one ledger effect from two identical seed calls", async () => {
    mocks.findCreditByTransNo
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(credit)
      .mockResolvedValueOnce(credit);

    await seedDevelopmentFixtures({ email: user.email, credits: 1000 });
    await seedDevelopmentFixtures({ email: user.email, credits: 1000 });

    expect(mocks.insertCredit).toHaveBeenCalledTimes(1);
  });
});
