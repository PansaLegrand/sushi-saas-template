import { beforeEach, describe, expect, it, vi } from "vitest";
import { respNoAuth } from "@/lib/resp";

const mocks = vi.hoisted(() => ({
  requireAdminRead: vi.fn(),
  listAdminUsers: vi.fn(),
  countAdminUsers: vi.fn(),
  listAdminPaidOrders: vi.fn(),
  countAdminPaidOrders: vi.fn(),
}));

vi.mock("@admin/lib/authz", () => ({
  requireAdminRead: mocks.requireAdminRead,
}));

vi.mock("@admin/lib/data", () => ({
  listAdminUsers: mocks.listAdminUsers,
  countAdminUsers: mocks.countAdminUsers,
  listAdminPaidOrders: mocks.listAdminPaidOrders,
  countAdminPaidOrders: mocks.countAdminPaidOrders,
}));

import { GET as listUsers } from "@admin/app/api/admin/users/route";
import { GET as listOrders } from "@admin/app/api/admin/orders/route";

const adminContext = {
  userId: "id-admin",
  userUuid: "u-admin",
  email: "admin@example.com",
  role: "admin_ro" as const,
};

describe("admin read API auth gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRead.mockResolvedValue(adminContext);
    mocks.listAdminUsers.mockResolvedValue([]);
    mocks.countAdminUsers.mockResolvedValue(0);
    mocks.listAdminPaidOrders.mockResolvedValue([]);
    mocks.countAdminPaidOrders.mockResolvedValue(0);
  });

  it("rejects users list requests before reading admin data", async () => {
    mocks.requireAdminRead.mockResolvedValue(respNoAuth());

    const res = await listUsers(new Request("http://admin.test/api/admin/users"));
    const payload = await res.json();

    expect(res.status).toBe(401);
    expect(payload.code).toBe(-2);
    expect(mocks.listAdminUsers).not.toHaveBeenCalled();
    expect(mocks.countAdminUsers).not.toHaveBeenCalled();
  });

  it("rejects orders list requests before reading admin data", async () => {
    mocks.requireAdminRead.mockResolvedValue(respNoAuth());

    const res = await listOrders(new Request("http://admin.test/api/admin/orders"));
    const payload = await res.json();

    expect(res.status).toBe(401);
    expect(payload.code).toBe(-2);
    expect(mocks.listAdminPaidOrders).not.toHaveBeenCalled();
    expect(mocks.countAdminPaidOrders).not.toHaveBeenCalled();
  });

  it("allows read-only admins to list users", async () => {
    const res = await listUsers(
      new Request("http://admin.test/api/admin/users?page=2&limit=10")
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(mocks.listAdminUsers).toHaveBeenCalledWith(2, 10);
    expect(mocks.countAdminUsers).toHaveBeenCalledTimes(1);
  });
});
