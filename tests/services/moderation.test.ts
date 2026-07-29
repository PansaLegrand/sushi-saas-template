/**
 * What a suspension actually does.
 *
 * The properties here are the ones that make a ban a ban rather than a
 * decoration. None of them are visible in a type check, and two of them —
 * reaching every account on an address, and failing closed — were the bugs that
 * would have made this feature look like it worked while an abuser walked
 * around it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUserByUuid: vi.fn(),
  findUserById: vi.fn(),
  findUsersByEmail: vi.fn(),
  markUserBanned: vi.fn(),
  markUserUnbanned: vi.fn(),
  deleteSessionsByUserId: vi.fn(),
  countSessionsByUserId: vi.fn(),
  findActiveBlocklistMatches: vi.fn(),
  findBlocklistEntry: vi.fn(),
  insertBlocklistEntry: vi.fn(),
  deleteBlocklistEntryByUuid: vi.fn(),
  listBlocklistEntries: vi.fn(),
  countBlocklistEntries: vi.fn(),
}));

vi.mock("@/models/user", () => ({
  findUserByUuid: mocks.findUserByUuid,
  findUserById: mocks.findUserById,
  findUsersByEmail: mocks.findUsersByEmail,
  markUserBanned: mocks.markUserBanned,
  markUserUnbanned: mocks.markUserUnbanned,
}));

vi.mock("@/models/session", () => ({
  deleteSessionsByUserId: mocks.deleteSessionsByUserId,
  countSessionsByUserId: mocks.countSessionsByUserId,
}));

vi.mock("@/models/email-blocklist", () => ({
  findActiveBlocklistMatches: mocks.findActiveBlocklistMatches,
  findBlocklistEntry: mocks.findBlocklistEntry,
  insertBlocklistEntry: mocks.insertBlocklistEntry,
  deleteBlocklistEntryByUuid: mocks.deleteBlocklistEntryByUuid,
  listBlocklistEntries: mocks.listBlocklistEntries,
  countBlocklistEntries: mocks.countBlocklistEntries,
}));

import {
  addBlocklistEntry,
  banUserAccount,
  checkSignupAllowed,
  isUserIdBanned,
  unbanUserAccount,
} from "@/services/moderation";

const NOW = new Date("2026-07-28T10:00:00.000Z");

/** The password account. */
const target = {
  id: "id-1",
  uuid: "u-1",
  email: "abuser@example.com",
  signin_provider: "credential",
  banned_at: null,
};

/** The same person, same address, signed up through Google on another day. */
const sibling = {
  id: "id-2",
  uuid: "u-2",
  email: "abuser@example.com",
  signin_provider: "google",
  banned_at: null,
};

function blocklistRow(overrides: Record<string, unknown> = {}) {
  return {
    uuid: "bl-1",
    scope: "email",
    value: "abuser@example.com",
    original_value: "abuser@example.com",
    reason: null,
    created_by: "admin-1",
    expires_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe("banUserAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUserByUuid.mockResolvedValue(target);
    mocks.findUsersByEmail.mockResolvedValue([target, sibling]);
    mocks.markUserBanned.mockImplementation(async ({ user_uuid }) => ({
      ...target,
      uuid: user_uuid,
      banned_at: NOW,
    }));
    mocks.deleteSessionsByUserId.mockResolvedValue(1);
    mocks.countSessionsByUserId.mockResolvedValue(0);
    mocks.findBlocklistEntry.mockResolvedValue(undefined);
    mocks.insertBlocklistEntry.mockResolvedValue(blocklistRow());
  });

  it("reports an unknown user instead of banning nothing quietly", async () => {
    mocks.findUserByUuid.mockResolvedValue(undefined);

    expect(
      await banUserAccount({ userUuid: "nope", actorUuid: "admin-1" }),
    ).toEqual({
      status: "not-found",
    });
  });

  it("bans every account on the address, not just the one it was given", async () => {
    // The bypass this closes: `users.email` is unique per provider, so banning
    // the row an abuser happened to use leaves their Google account open and
    // the ban is one click away from meaningless.
    const outcome = await banUserAccount({
      userUuid: "u-1",
      actorUuid: "admin-1",
    });

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;

    expect(mocks.markUserBanned).toHaveBeenCalledTimes(2);
    expect(outcome.result.applied).toBe(true);
    expect(outcome.result.alsoBanned).toEqual(["u-2"]);
  });

  it("revokes sessions on every affected account", async () => {
    // Without this the ban takes effect whenever the cookie happens to expire,
    // which for an active abuser is not soon enough to matter.
    const outcome = await banUserAccount({
      userUuid: "u-1",
      actorUuid: "admin-1",
    });

    expect(mocks.deleteSessionsByUserId).toHaveBeenCalledWith("id-1");
    expect(mocks.deleteSessionsByUserId).toHaveBeenCalledWith("id-2");
    if (outcome.status === "ok") expect(outcome.result.sessionsRevoked).toBe(2);
  });

  it("blocks the address by default", async () => {
    // The default matters more than the option: without a blocklist entry the
    // banned person signs up again through a provider they have not used, and
    // the fresh row is not banned.
    const outcome = await banUserAccount({
      userUuid: "u-1",
      actorUuid: "admin-1",
    });

    expect(mocks.insertBlocklistEntry).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "email", value: "abuser@example.com" }),
    );
    if (outcome.status === "ok") {
      expect(outcome.result.blocklisted?.value).toBe("abuser@example.com");
    }
  });

  it("leaves the address open when the admin says so", async () => {
    const outcome = await banUserAccount({
      userUuid: "u-1",
      actorUuid: "admin-1",
      blockEmail: false,
    });

    expect(mocks.insertBlocklistEntry).not.toHaveBeenCalled();
    if (outcome.status === "ok") expect(outcome.result.blocklisted).toBeNull();
  });

  it("keeps the first ban's record when banned again", async () => {
    // "Banned an hour ago for spam" is the fact worth keeping; "banned just now
    // for see above" is the one that destroys it.
    mocks.markUserBanned.mockResolvedValue(undefined);

    const outcome = await banUserAccount({
      userUuid: "u-1",
      actorUuid: "admin-2",
    });

    if (outcome.status !== "ok") throw new Error("expected ok");
    expect(outcome.result.applied).toBe(false);
    expect(outcome.result.alsoBanned).toEqual([]);
  });

  it("still revokes sessions on a repeat ban", async () => {
    // A banned account holding a live session is exactly the situation someone
    // is trying to fix by banning it a second time.
    mocks.markUserBanned.mockResolvedValue(undefined);

    await banUserAccount({ userUuid: "u-1", actorUuid: "admin-2" });

    expect(mocks.deleteSessionsByUserId).toHaveBeenCalledTimes(2);
  });

  it("truncates an over-long reason rather than failing the ban", async () => {
    await banUserAccount({
      userUuid: "u-1",
      actorUuid: "admin-1",
      reason: "x".repeat(900),
    });

    const [{ reason }] = mocks.markUserBanned.mock.calls[0];
    expect(reason).toHaveLength(500);
  });
});

describe("unbanUserAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUserByUuid.mockResolvedValue({ ...target, banned_at: NOW });
    mocks.findUsersByEmail.mockResolvedValue([target, sibling]);
    mocks.markUserUnbanned.mockImplementation(async (uuid) => ({
      ...target,
      uuid,
      banned_at: null,
    }));
    mocks.countSessionsByUserId.mockResolvedValue(0);
    mocks.findActiveBlocklistMatches.mockResolvedValue([]);
    mocks.findBlocklistEntry.mockResolvedValue(blocklistRow());
    mocks.deleteBlocklistEntryByUuid.mockResolvedValue(blocklistRow());
  });

  it("restores every account on the address", async () => {
    const outcome = await unbanUserAccount({ userUuid: "u-1" });

    if (outcome.status !== "ok") throw new Error("expected ok");
    expect(outcome.result.applied).toBe(true);
    expect(outcome.result.alsoUnbanned).toEqual(["u-2"]);
  });

  it("leaves the address blocked unless asked", async () => {
    // A rule may predate this account or cover a whole domain, so lifting it is
    // a separate decision from lifting the ban.
    await unbanUserAccount({ userUuid: "u-1" });

    expect(mocks.deleteBlocklistEntryByUuid).not.toHaveBeenCalled();
  });

  it("lifts the address block when asked", async () => {
    await unbanUserAccount({ userUuid: "u-1", removeBlocklistEntry: true });

    expect(mocks.deleteBlocklistEntryByUuid).toHaveBeenCalledWith("bl-1");
  });

  it("reports rules that still stop this address registering", async () => {
    // The confusing state this prevents: an account that can sign in, cannot
    // re-register, and shows "not banned" everywhere an admin thinks to look.
    mocks.findActiveBlocklistMatches.mockResolvedValue([
      blocklistRow({ scope: "domain", value: "example.com", uuid: "bl-2" }),
    ]);

    const outcome = await unbanUserAccount({ userUuid: "u-1" });

    if (outcome.status !== "ok") throw new Error("expected ok");
    expect(outcome.result.remainingBlocklistEntries).toHaveLength(1);
    expect(outcome.result.remainingBlocklistEntries[0].scope).toBe("domain");
  });
});

describe("checkSignupAllowed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findActiveBlocklistMatches.mockResolvedValue([]);
  });

  it("allows an address nothing matches", async () => {
    expect(await checkSignupAllowed("new@example.com")).toEqual({
      allowed: true,
    });
  });

  it("looks up the normalized form, not the raw input", async () => {
    await checkSignupAllowed("A.N.N+throwaway@googlemail.com");

    expect(mocks.findActiveBlocklistMatches).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedEmail: "ann@gmail.com",
        normalizedDomain: "gmail.com",
      }),
    );
  });

  it("names the domain rule when both kinds match", async () => {
    // Both are a block; the domain one is the broader fact and the one an
    // operator reading the log needs.
    mocks.findActiveBlocklistMatches.mockResolvedValue([
      blocklistRow({ scope: "email", value: "abuser@example.com" }),
      blocklistRow({ scope: "domain", value: "example.com", uuid: "bl-2" }),
    ]);

    expect(await checkSignupAllowed("abuser@example.com")).toMatchObject({
      allowed: false,
      reason: "domain",
    });
  });

  it("does not query for input that is not an address", async () => {
    expect(await checkSignupAllowed("garbage")).toEqual({ allowed: true });
    expect(mocks.findActiveBlocklistMatches).not.toHaveBeenCalled();
  });

  it("fails open when the lookup throws", async () => {
    // Deliberate. This is an abuse filter, not an authentication check: a
    // missing migration or a brief outage must not stop every legitimate signup
    // in the product. Degraded abuse protection beats a closed front door.
    mocks.findActiveBlocklistMatches.mockRejectedValue(new Error("db down"));

    expect(await checkSignupAllowed("someone@example.com")).toEqual({
      allowed: true,
    });
  });
});

describe("isUserIdBanned", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is true only when the account carries a ban timestamp", async () => {
    mocks.findUserById.mockResolvedValue({ ...target, banned_at: NOW });
    expect(await isUserIdBanned("id-1")).toBe(true);

    mocks.findUserById.mockResolvedValue(target);
    expect(await isUserIdBanned("id-1")).toBe(false);
  });

  it("fails closed when the lookup throws", async () => {
    mocks.findUserById.mockRejectedValue(new Error("db down"));
    await expect(isUserIdBanned("id-1")).rejects.toThrow("db down");
  });
});

describe("addBlocklistEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findBlocklistEntry.mockResolvedValue(undefined);
    mocks.insertBlocklistEntry.mockResolvedValue(blocklistRow());
  });

  it("stores the normalized key, and the input beside it", async () => {
    await addBlocklistEntry({
      scope: "email",
      value: " A.N.N+spam@Gmail.com ",
      actorUuid: "admin-1",
    });

    expect(mocks.insertBlocklistEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "ann@gmail.com",
        original_value: "A.N.N+spam@Gmail.com",
      }),
    );
  });

  it("rejects input with no key to match on", async () => {
    expect(
      await addBlocklistEntry({
        scope: "email",
        value: "nonsense",
        actorUuid: "a",
      }),
    ).toEqual({
      status: "invalid",
    });
    expect(mocks.insertBlocklistEntry).not.toHaveBeenCalled();
  });

  it("is idempotent rather than stacking duplicate rules", async () => {
    mocks.findBlocklistEntry.mockResolvedValue(blocklistRow());

    const outcome = await addBlocklistEntry({
      scope: "email",
      value: "abuser@example.com",
      actorUuid: "admin-1",
    });

    expect(outcome.status).toBe("exists");
    expect(mocks.insertBlocklistEntry).not.toHaveBeenCalled();
  });

  it("treats a lost insert race as an existing rule", async () => {
    // Two admins clicking block at once. The unique index did its job; the rule
    // they asked for exists, which is all either of them wanted.
    mocks.findBlocklistEntry
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(blocklistRow());
    mocks.insertBlocklistEntry.mockRejectedValue(
      Object.assign(new Error("duplicate key"), { code: "23505" }),
    );

    const outcome = await addBlocklistEntry({
      scope: "email",
      value: "abuser@example.com",
      actorUuid: "admin-2",
    });

    expect(outcome.status).toBe("exists");
  });
});
