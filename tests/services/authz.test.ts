import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUserById: vi.fn(),
  findMembershipBySlug: vi.fn(),
  findMembershipsByUserId: vi.fn(),
  ensurePersonalOrganization: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

vi.mock("@/models/user", () => ({
  findUserById: mocks.findUserById,
}));

vi.mock("@/models/organization", async () => {
  const actual =
    await vi.importActual<typeof import("@/models/organization")>(
      "@/models/organization"
    );

  return {
    ...actual,
    findMembershipBySlug: mocks.findMembershipBySlug,
    findMembershipsByUserId: mocks.findMembershipsByUserId,
  };
});

vi.mock("@/services/organizations", () => ({
  ensurePersonalOrganization: mocks.ensurePersonalOrganization,
}));

import { allowedActions, can, getOrgContextFromHeaders } from "@/services/authz";

function org(overrides: Record<string, unknown> = {}) {
  return {
    id: "org-1",
    uuid: "org-uuid-1",
    slug: "acme",
    name: "Acme",
    is_personal: false,
    ...overrides,
  };
}

function membership(role = "member", organization = org()) {
  return { member: { user_id: "id-1", role }, organization };
}

const headers = new Headers({ cookie: "session=test" });

describe("organization policy", () => {
  it("gives an owner every action", () => {
    expect(can({ role: "owner" }, "org:delete")).toBe(true);
    expect(can({ role: "owner" }, "billing:manage")).toBe(true);
    expect(can({ role: "owner" }, "file:create")).toBe(true);
  });

  it("lets an admin manage members but not delete the org", () => {
    expect(can({ role: "admin" }, "member:manage")).toBe(true);
    expect(can({ role: "admin" }, "org:update")).toBe(true);
    expect(can({ role: "admin" }, "org:delete")).toBe(false);
  });

  it("keeps billing with the owner", () => {
    // The subscription is billed to the owner; an admin changing the plan
    // spends someone else's money. Deliberate default, one line to change.
    expect(can({ role: "admin" }, "billing:manage")).toBe(false);
    expect(can({ role: "member" }, "billing:manage")).toBe(false);
    expect(can({ role: "admin" }, "billing:read")).toBe(true);
  });

  it("lets a member work with org content but not manage the org", () => {
    expect(can({ role: "member" }, "file:create")).toBe(true);
    expect(can({ role: "member" }, "file:delete")).toBe(true);
    expect(can({ role: "member" }, "credit:spend")).toBe(true);
    expect(can({ role: "member" }, "member:manage")).toBe(false);
    expect(can({ role: "member" }, "org:update")).toBe(false);
  });

  it("nests roles so an owner is never denied what a member may do", () => {
    // Guards against the failure mode of three hand-maintained lists drifting:
    // an action added to members but forgotten for owners.
    const member = new Set(allowedActions("member"));
    const admin = new Set(allowedActions("admin"));
    const owner = new Set(allowedActions("owner"));

    for (const action of member) expect(admin.has(action)).toBe(true);
    for (const action of admin) expect(owner.has(action)).toBe(true);
  });

  it("denies an action the policy does not list", () => {
    expect(can({ role: "member" }, "nope:at:all" as never)).toBe(false);
  });
});

describe("organization context resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "id-1", uuid: "u-1", email: "a@test.dev", name: "A" },
      session: { activeOrganizationId: null },
    });
  });

  it("returns null without a session", async () => {
    mocks.getSession.mockResolvedValue(null);

    expect(await getOrgContextFromHeaders(headers)).toBeNull();
  });

  it("resolves the organization named in the URL", async () => {
    mocks.findMembershipBySlug.mockResolvedValue(membership("admin"));

    const ctx = await getOrgContextFromHeaders(headers, "acme");

    expect(ctx).toMatchObject({
      userId: "id-1",
      userUuid: "u-1",
      orgUuid: "org-uuid-1",
      orgSlug: "acme",
      role: "admin",
    });
  });

  it("refuses a URL org the user does not belong to", async () => {
    mocks.findMembershipBySlug.mockResolvedValue(undefined);
    mocks.findMembershipsByUserId.mockResolvedValue([membership("owner")]);

    // Critically, it must NOT fall back to an org the user does have. Serving a
    // different tenant than the URL named is the worst outcome of a bad link.
    expect(await getOrgContextFromHeaders(headers, "someone-elses")).toBeNull();
    expect(mocks.findMembershipsByUserId).not.toHaveBeenCalled();
  });

  it("uses the session's active organization when the URL names none", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "id-1", uuid: "u-1", email: "a@test.dev" },
      session: { activeOrganizationId: "org-2" },
    });
    mocks.findMembershipsByUserId.mockResolvedValue([
      membership("owner", org({ id: "org-1", is_personal: true })),
      membership("member", org({ id: "org-2", uuid: "org-uuid-2", slug: "team" })),
    ]);

    const ctx = await getOrgContextFromHeaders(headers);

    expect(ctx?.orgSlug).toBe("team");
    expect(ctx?.role).toBe("member");
  });

  it("prefers the personal org when nothing else points anywhere", async () => {
    mocks.findMembershipsByUserId.mockResolvedValue([
      membership("member", org({ id: "org-2", slug: "team" })),
      membership("owner", org({ id: "org-1", slug: "mine", is_personal: true })),
    ]);

    expect((await getOrgContextFromHeaders(headers))?.orgSlug).toBe("mine");
  });

  it("repairs a user who somehow has no organization", async () => {
    mocks.findMembershipsByUserId.mockResolvedValue([]);
    mocks.ensurePersonalOrganization.mockResolvedValue(
      org({ id: "org-new", uuid: "org-uuid-new", slug: "recovered" })
    );

    const ctx = await getOrgContextFromHeaders(headers);

    // A signup hook that failed part-way leaves an account that can load
    // nothing. Healing here beats a support ticket only SQL can close.
    expect(mocks.ensurePersonalOrganization).toHaveBeenCalledWith({
      id: "id-1",
      email: "a@test.dev",
      nickname: "A",
    });
    expect(ctx?.orgSlug).toBe("recovered");
    expect(ctx?.role).toBe("owner");
  });

  it("falls back to uuid lookup when the session carries no uuid", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "id-1", email: "a@test.dev" },
      session: { activeOrganizationId: null },
    });
    mocks.findUserById.mockResolvedValue({ id: "id-1", uuid: "u-from-db" });
    mocks.findMembershipsByUserId.mockResolvedValue([membership("owner")]);

    expect((await getOrgContextFromHeaders(headers))?.userUuid).toBe("u-from-db");
  });

  it("treats an unrecognized role as the least privileged one", async () => {
    mocks.findMembershipBySlug.mockResolvedValue(membership("superuser"));

    const ctx = await getOrgContextFromHeaders(headers, "acme");

    // A typo in a manual SQL update must not grant anything.
    expect(ctx?.role).toBe("member");
    expect(can({ role: ctx!.role }, "member:manage")).toBe(false);
  });
});
