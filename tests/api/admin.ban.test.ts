/**
 * The admin ban endpoints.
 *
 * Suspending an account is the most consequential button in the console: it
 * takes a paying customer's access away, and the person who pressed it is often
 * the only record of why. The properties asserted here are the ones that make
 * that survivable — a read-only admin cannot press it, every attempt lands in
 * the audit trail whether or not it changed anything, and an admin cannot lock
 * themselves out of the console with a mistyped uuid.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { respForbidden, respNoAuth } from "@/lib/resp";

const mocks = vi.hoisted(() => ({
  requireAdminRead: vi.fn(),
  requireAdminWrite: vi.fn(),
  writeAdminAuditLog: vi.fn(),
  banUserAccount: vi.fn(),
  unbanUserAccount: vi.fn(),
  getBanState: vi.fn(),
  findMatchingBlocklistEntries: vi.fn(),
  addBlocklistEntry: vi.fn(),
  listBlocklist: vi.fn(),
  removeBlocklistEntry: vi.fn(),
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

vi.mock("@/services/moderation", () => ({
  banUserAccount: mocks.banUserAccount,
  unbanUserAccount: mocks.unbanUserAccount,
  getBanState: mocks.getBanState,
  findMatchingBlocklistEntries: mocks.findMatchingBlocklistEntries,
  addBlocklistEntry: mocks.addBlocklistEntry,
  listBlocklist: mocks.listBlocklist,
  removeBlocklistEntry: mocks.removeBlocklistEntry,
}));

import {
  DELETE as unban,
  GET as readBan,
  POST as ban,
} from "@admin/app/api/admin/users/[uuid]/ban/route";
import {
  GET as listRules,
  POST as addRule,
} from "@admin/app/api/admin/blocklist/route";
import { DELETE as removeRule } from "@admin/app/api/admin/blocklist/[uuid]/route";

const params = (uuid: string) => ({ params: Promise.resolve({ uuid }) });

const readOnlyAdmin = {
  userId: "id-admin",
  userUuid: "u-admin",
  email: "admin@example.com",
  role: "admin_ro" as const,
};

const writeAdmin = { ...readOnlyAdmin, role: "admin_rw" as const };

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const banState = {
  userUuid: "u-1",
  email: "abuser@example.com",
  banned: true,
  bannedAt: "2026-07-28T10:00:00.000Z",
  reason: "spam",
  bannedBy: "u-admin",
  activeSessions: 0,
};

describe("admin ban API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRead.mockResolvedValue(readOnlyAdmin);
    mocks.requireAdminWrite.mockResolvedValue(writeAdmin);
    mocks.getBanState.mockResolvedValue(banState);
    mocks.findMatchingBlocklistEntries.mockResolvedValue([]);
    mocks.banUserAccount.mockResolvedValue({
      status: "ok",
      result: {
        userUuid: "u-1",
        email: "abuser@example.com",
        applied: true,
        alsoBanned: ["u-2"],
        sessionsRevoked: 3,
        blocklisted: { uuid: "bl-1", value: "abuser@example.com" },
        state: banState,
      },
    });
    mocks.unbanUserAccount.mockResolvedValue({
      status: "ok",
      result: {
        userUuid: "u-1",
        applied: true,
        alsoUnbanned: [],
        remainingBlocklistEntries: [],
        state: { ...banState, banned: false },
      },
    });
  });

  it("refuses to read ban state before the admin gate passes", async () => {
    mocks.requireAdminRead.mockResolvedValue(respNoAuth());

    const res = await readBan(new Request("http://admin.test"), params("u-1"));

    expect(res.status).toBe(401);
    expect(mocks.getBanState).not.toHaveBeenCalled();
  });

  it("reports an unknown user rather than an unbanned-looking one", async () => {
    // A zeroed state for a mistyped uuid reads exactly like a healthy account.
    mocks.getBanState.mockResolvedValue(null);

    const res = await readBan(new Request("http://admin.test"), params("nope"));
    const payload = await res.json();

    expect(res.status).toBe(404);
    expect(payload.error_code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("returns blocklist rules alongside the ban state", async () => {
    // The two answer one question together: an account that is not banned but
    // whose address is blocked can sign in and cannot re-register.
    mocks.findMatchingBlocklistEntries.mockResolvedValue([
      { uuid: "bl-2", scope: "domain", value: "example.com" },
    ]);

    const res = await readBan(new Request("http://admin.test"), params("u-1"));
    const payload = await res.json();

    expect(payload.data.blocklistEntries).toHaveLength(1);
  });

  it("refuses a ban from a read-only admin", async () => {
    mocks.requireAdminWrite.mockResolvedValue(respForbidden());

    const res = await ban(
      jsonRequest("http://admin.test/api/admin/users/u-1/ban", "POST", {}),
      params("u-1")
    );

    expect(res.status).toBe(403);
    expect(mocks.banUserAccount).not.toHaveBeenCalled();
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled();
  });

  it("refuses to let an admin ban themselves", async () => {
    // The uuid field is a paste target during exactly the kind of incident
    // where nobody is being careful, and this mistake cannot be undone from
    // inside the console it locks.
    const res = await ban(
      jsonRequest("http://admin.test/api/admin/users/u-admin/ban", "POST", {}),
      params("u-admin")
    );

    expect(res.status).toBe(403);
    expect(mocks.banUserAccount).not.toHaveBeenCalled();
  });

  it("passes the blockEmail choice through instead of deciding for the admin", async () => {
    await ban(
      jsonRequest("http://admin.test/api/admin/users/u-1/ban", "POST", {
        reason: "spam",
        blockEmail: false,
      }),
      params("u-1")
    );

    expect(mocks.banUserAccount).toHaveBeenCalledWith({
      userUuid: "u-1",
      reason: "spam",
      actorUuid: "u-admin",
      blockEmail: false,
    });
  });

  it("records who banned whom, and what it took down with it", async () => {
    await ban(
      jsonRequest("http://admin.test/api/admin/users/u-1/ban", "POST", {
        reason: "spam",
      }),
      params("u-1")
    );

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: writeAdmin,
        action: "user.ban",
        targetType: "user",
        targetUuid: "u-1",
        note: "spam",
        metadata: expect.objectContaining({
          targetEmail: "abuser@example.com",
          alsoBanned: ["u-2"],
          sessionsRevoked: 3,
          blocklisted: "abuser@example.com",
        }),
      })
    );
  });

  it("audits a repeat ban even though nothing changed", async () => {
    // "Who tried, and when" is the part of an incident timeline that cannot be
    // reconstructed afterwards.
    mocks.banUserAccount.mockResolvedValue({
      status: "ok",
      result: {
        userUuid: "u-1",
        email: "abuser@example.com",
        applied: false,
        alsoBanned: [],
        sessionsRevoked: 0,
        blocklisted: null,
        state: banState,
      },
    });

    await ban(
      jsonRequest("http://admin.test/api/admin/users/u-1/ban", "POST", {}),
      params("u-1")
    );

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.ban",
        metadata: expect.objectContaining({ applied: false }),
      })
    );
  });

  it("records a failed ban rather than losing the attempt", async () => {
    mocks.banUserAccount.mockRejectedValue(new Error("db down"));

    const res = await ban(
      jsonRequest("http://admin.test/api/admin/users/u-1/ban", "POST", {}),
      params("u-1")
    );

    expect(res.status).toBe(500);
    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.ban", status: "failed" })
    );
  });

  it("unbans without a request body", async () => {
    // The console's plain "lift suspension" button sends none.
    const res = await unban(
      new Request("http://admin.test", { method: "DELETE" }),
      params("u-1")
    );

    expect(res.status).toBe(200);
    expect(mocks.unbanUserAccount).toHaveBeenCalledWith({
      userUuid: "u-1",
      removeBlocklistEntry: undefined,
    });
  });

  it("lifts the address block only when asked", async () => {
    await unban(
      jsonRequest("http://admin.test/api/admin/users/u-1/ban", "DELETE", {
        removeBlocklistEntry: true,
      }),
      params("u-1")
    );

    expect(mocks.unbanUserAccount).toHaveBeenCalledWith({
      userUuid: "u-1",
      removeBlocklistEntry: true,
    });
  });
});

describe("admin blocklist API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRead.mockResolvedValue(readOnlyAdmin);
    mocks.requireAdminWrite.mockResolvedValue(writeAdmin);
    mocks.listBlocklist.mockResolvedValue({ items: [], total: 0 });
    mocks.addBlocklistEntry.mockResolvedValue({
      status: "added",
      entry: {
        uuid: "bl-1",
        scope: "email",
        value: "abuser@example.com",
        originalValue: "Abuser+1@Example.com",
        expiresAt: null,
      },
    });
    mocks.removeBlocklistEntry.mockResolvedValue({
      uuid: "bl-1",
      scope: "domain",
      value: "example.com",
      originalValue: "example.com",
      reason: "disposable",
      createdBy: "u-admin",
    });
  });

  it("refuses to list rules before the admin gate passes", async () => {
    mocks.requireAdminRead.mockResolvedValue(respNoAuth());

    const res = await listRules(new Request("http://admin.test/api/admin/blocklist"));

    expect(res.status).toBe(401);
    expect(mocks.listBlocklist).not.toHaveBeenCalled();
  });

  it("passes a search term through to the service, which normalizes it", async () => {
    // The route deliberately does not normalize: one rule, one place. It only
    // has to not swallow the term.
    await listRules(
      new Request("http://admin.test/api/admin/blocklist?q=%20a.b%2Bx%40gmail.com%20")
    );

    expect(mocks.listBlocklist).toHaveBeenCalledWith(1, 50, "a.b+x@gmail.com");
  });

  it("treats a blank search as no search", async () => {
    await listRules(new Request("http://admin.test/api/admin/blocklist?q=%20"));

    expect(mocks.listBlocklist).toHaveBeenCalledWith(1, 50, undefined);
  });

  it("refuses a new rule from a read-only admin", async () => {
    mocks.requireAdminWrite.mockResolvedValue(respForbidden());

    const res = await addRule(
      jsonRequest("http://admin.test/api/admin/blocklist", "POST", {
        scope: "domain",
        value: "example.com",
      })
    );

    expect(res.status).toBe(403);
    expect(mocks.addBlocklistEntry).not.toHaveBeenCalled();
  });

  it("rejects a scope that is not a real one", async () => {
    const res = await addRule(
      jsonRequest("http://admin.test/api/admin/blocklist", "POST", {
        scope: "everything",
        value: "example.com",
      })
    );

    expect(res.status).toBe(400);
    expect(mocks.addBlocklistEntry).not.toHaveBeenCalled();
  });

  it("reports unparseable input as a bad field, not a server failure", async () => {
    mocks.addBlocklistEntry.mockResolvedValue({ status: "invalid" });

    const res = await addRule(
      jsonRequest("http://admin.test/api/admin/blocklist", "POST", {
        scope: "email",
        value: "nonsense",
      })
    );
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload.details).toMatchObject({ field: "value" });
  });

  it("rejects an unparseable expiry rather than blocking forever", async () => {
    // The dangerous default: a bad date silently becoming null is a permanent
    // block nobody intended.
    const res = await addRule(
      jsonRequest("http://admin.test/api/admin/blocklist", "POST", {
        scope: "email",
        value: "abuser@example.com",
        expiresAt: "not-a-date",
      })
    );

    expect(res.status).toBe(400);
    expect(mocks.addBlocklistEntry).not.toHaveBeenCalled();
  });

  it("audits a rule that was actually created", async () => {
    await addRule(
      jsonRequest("http://admin.test/api/admin/blocklist", "POST", {
        scope: "email",
        value: "Abuser+1@Example.com",
        reason: "signup flood",
      })
    );

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "blocklist.add",
        targetType: "blocklist",
        targetUuid: "bl-1",
        note: "signup flood",
        metadata: expect.objectContaining({ value: "abuser@example.com" }),
      })
    );
  });

  it("writes no audit entry for a re-add", async () => {
    // Nothing changed. A trail that records non-events is one people stop
    // reading, which is how the real entries get missed.
    mocks.addBlocklistEntry.mockResolvedValue({
      status: "exists",
      entry: { uuid: "bl-1", scope: "email", value: "abuser@example.com" },
    });

    const res = await addRule(
      jsonRequest("http://admin.test/api/admin/blocklist", "POST", {
        scope: "email",
        value: "abuser@example.com",
      })
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.data.created).toBe(false);
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled();
  });

  it("records the full rule when one is lifted", async () => {
    // The row is gone, so this entry is the only remaining answer to "what was
    // blocked" when a blocked address turns out to have been a real customer.
    await removeRule(
      new Request("http://admin.test", { method: "DELETE" }),
      params("bl-1")
    );

    expect(mocks.writeAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "blocklist.remove",
        metadata: expect.objectContaining({
          scope: "domain",
          value: "example.com",
          addedBy: "u-admin",
        }),
      })
    );
  });

  it("reports a rule that was already gone", async () => {
    mocks.removeBlocklistEntry.mockResolvedValue(null);

    const res = await removeRule(
      new Request("http://admin.test", { method: "DELETE" }),
      params("bl-missing")
    );

    expect(res.status).toBe(404);
    expect(mocks.writeAdminAuditLog).not.toHaveBeenCalled();
  });
});
