import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  getSession: vi.fn(),
  findUserById: vi.fn(),
  findUserByUuid: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: mocks.getSession,
    },
  },
}));

vi.mock("@/models/user", () => ({
  findUserById: mocks.findUserById,
  findUserByUuid: mocks.findUserByUuid,
}));

import {
  getAdminContext,
  getAdminIdentity,
  requireAdminRead,
  requireAdminWrite,
} from "@admin/lib/authz";

function sessionUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "id-admin",
    email: "admin@example.com",
    uuid: "u-admin",
    ...overrides,
  };
}

function dbUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "id-admin",
    uuid: "u-admin",
    email: "admin@example.com",
    role: "admin_rw",
    two_factor_enabled: true,
    ...overrides,
  };
}

describe("admin authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(new Headers({ cookie: "admin-session=test" }));
    mocks.getSession.mockResolvedValue(null);
    mocks.findUserById.mockResolvedValue(undefined);
    mocks.findUserByUuid.mockResolvedValue(undefined);
  });

  it("returns null without a session and avoids user lookup", async () => {
    await expect(getAdminContext()).resolves.toBeNull();

    expect(mocks.findUserByUuid).not.toHaveBeenCalled();
    expect(mocks.findUserById).not.toHaveBeenCalled();
  });

  it("authorizes admin roles by session uuid", async () => {
    mocks.getSession.mockResolvedValue({ user: sessionUser() });
    mocks.findUserByUuid.mockResolvedValue(dbUser());

    await expect(getAdminContext()).resolves.toEqual({
      userId: "id-admin",
      userUuid: "u-admin",
      email: "admin@example.com",
      role: "admin_rw",
      mfaEnabled: true,
    });

    expect(mocks.findUserByUuid).toHaveBeenCalledWith("u-admin");
    expect(mocks.findUserById).not.toHaveBeenCalled();
  });

  it("falls back to the Better Auth user id when uuid is missing", async () => {
    mocks.getSession.mockResolvedValue({
      user: sessionUser({ uuid: undefined }),
    });
    mocks.findUserById.mockResolvedValue(dbUser({ role: "admin_ro" }));

    await expect(getAdminContext()).resolves.toEqual({
      userId: "id-admin",
      userUuid: "u-admin",
      email: "admin@example.com",
      role: "admin_ro",
      mfaEnabled: true,
    });

    expect(mocks.findUserById).toHaveBeenCalledWith("id-admin");
  });

  it("does not authorize ordinary users", async () => {
    mocks.getSession.mockResolvedValue({ user: sessionUser() });
    mocks.findUserByUuid.mockResolvedValue(dbUser({ role: "user" }));

    await expect(getAdminContext()).resolves.toBeNull();
  });

  it("fails closed when the loaded row does not match the session id", async () => {
    mocks.getSession.mockResolvedValue({ user: sessionUser() });
    mocks.findUserByUuid.mockResolvedValue(dbUser({ id: "id-other" }));

    await expect(getAdminContext()).resolves.toBeNull();
  });

  it("does not authorize an admin role until MFA is enabled", async () => {
    mocks.getSession.mockResolvedValue({ user: sessionUser() });
    mocks.findUserByUuid.mockResolvedValue(dbUser({ two_factor_enabled: false }));

    await expect(getAdminContext()).resolves.toBeNull();
  });

  it("returns the admin identity even when MFA setup is still required", async () => {
    mocks.getSession.mockResolvedValue({ user: sessionUser() });
    mocks.findUserByUuid.mockResolvedValue(dbUser({ two_factor_enabled: false }));

    await expect(getAdminIdentity()).resolves.toEqual({
      userId: "id-admin",
      userUuid: "u-admin",
      email: "admin@example.com",
      role: "admin_rw",
      mfaEnabled: false,
    });
  });

  it("does not authorize from email-only session data", async () => {
    mocks.getSession.mockResolvedValue({
      user: {
        email: "admin@example.com",
      },
    });

    await expect(getAdminContext()).resolves.toBeNull();

    expect(mocks.findUserByUuid).not.toHaveBeenCalled();
    expect(mocks.findUserById).not.toHaveBeenCalled();
  });

  it("allows read-only admins through read gates", async () => {
    mocks.getSession.mockResolvedValue({ user: sessionUser() });
    mocks.findUserByUuid.mockResolvedValue(dbUser({ role: "admin_ro" }));

    const result = await requireAdminRead();

    expect(result).not.toBeInstanceOf(Response);
    expect((result as any).role).toBe("admin_ro");
  });

  it("returns 403 from admin gates when MFA is missing", async () => {
    mocks.getSession.mockResolvedValue({ user: sessionUser() });
    mocks.findUserByUuid.mockResolvedValue(dbUser({ two_factor_enabled: false }));

    const result = await requireAdminRead();
    const payload = await (result as Response).json();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(payload.code).toBe(-3);
  });

  it("blocks read-only admins from write gates", async () => {
    mocks.getSession.mockResolvedValue({ user: sessionUser() });
    mocks.findUserByUuid.mockResolvedValue(dbUser({ role: "admin_ro" }));

    const result = await requireAdminWrite();
    const payload = await (result as Response).json();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    expect(payload.code).toBe(-3);
  });

  it("returns 401 from admin gates when there is no admin context", async () => {
    const result = await requireAdminRead();
    const payload = await (result as Response).json();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(payload.code).toBe(-2);
  });
});
