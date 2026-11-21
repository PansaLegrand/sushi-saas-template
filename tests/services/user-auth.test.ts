import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUserById: vi.fn(),
  findUserByUuid: vi.fn(),
  getUserCreditSummary: vi.fn(),
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

vi.mock("@/services/credit", () => ({
  getUserCreditSummary: mocks.getUserCreditSummary,
}));

import { getUserUuid } from "@/services/user";

function request() {
  return new Request("http://test.local/api/account/profile", {
    headers: { cookie: "better-auth.session_token=test" },
  });
}

describe("getUserUuid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue(null);
    mocks.findUserById.mockResolvedValue(undefined);
  });

  it("returns null when there is no active session", async () => {
    const req = request();

    await expect(getUserUuid(req)).resolves.toBeNull();

    expect(mocks.getSession).toHaveBeenCalledWith({
      headers: req.headers,
    });
    expect(mocks.findUserById).not.toHaveBeenCalled();
  });

  it("resolves current account state even when the session contains a uuid", async () => {
    mocks.getSession.mockResolvedValue({
      user: {
        id: "id-user",
        email: "user@example.com",
        uuid: "u-session",
      },
    });

    mocks.findUserById.mockResolvedValue({ id: "id-user", uuid: "u-db" });
    await expect(getUserUuid(request())).resolves.toBe("u-db");
    expect(mocks.findUserById).toHaveBeenCalledWith("id-user");
  });

  it.each([{ banned_at: new Date() }, { lifecycle_status: "erasing" }])("denies a surviving session after account restriction", async (restriction) => {
    mocks.getSession.mockResolvedValue({ user: { id: "id-user", uuid: "u-session" } });
    mocks.findUserById.mockResolvedValue({ id: "id-user", uuid: "u-db", ...restriction });
    await expect(getUserUuid(request())).resolves.toBeNull();
  });

  it("falls back to the Better Auth user id when the session omits uuid", async () => {
    mocks.getSession.mockResolvedValue({
      user: {
        id: "id-user",
        email: "shared@example.com",
      },
    });
    mocks.findUserById.mockResolvedValue({ id: "id-user", uuid: "u-db" });

    await expect(getUserUuid(request())).resolves.toBe("u-db");

    expect(mocks.findUserById).toHaveBeenCalledWith("id-user");
  });

  it("fails closed when the session cannot be resolved to a user row", async () => {
    mocks.getSession.mockResolvedValue({
      user: {
        id: "id-missing",
        email: "shared@example.com",
      },
    });

    await expect(getUserUuid(request())).resolves.toBeNull();

    expect(mocks.findUserById).toHaveBeenCalledWith("id-missing");
  });
});
