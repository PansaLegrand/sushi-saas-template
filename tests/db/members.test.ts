/**
 * Database tier: the membership rules that keep an organization usable.
 *
 * Better Auth will happily delete the last owner's membership row or demote
 * them — it has no opinion about what that leaves behind. What it leaves behind
 * is an organization nobody can invite into, bill, or administer, with no
 * self-serve path back. These tests pin the two guards that prevent it, against
 * real rows, because both are decided by a `count(*)` rather than by anything a
 * mock could model.
 */
import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { orgMembers, users } from "@/db/schema";
import { asOrgUuid, countOwners } from "@/models/organization";
import {
  assertCanAssign,
  assertNotLastOrganization,
  assertNotLastOwner,
  assignableRoles,
  getTeam,
} from "@/services/members";
import { ensurePersonalOrganization } from "@/services/organizations";
import type { OrgContext } from "@/services/authz";

useCleanDatabase();

let owner: { id: string; uuid: string };
let orgId: string;
let orgUuid: string;

async function newUser(label: string) {
  const id = randomUUID();
  const uuid = randomUUID();
  const email = `${label}-${uuid}@test.dev`;

  await db().insert(users).values({ id, uuid, email, signin_provider: "credential" });
  return { id, uuid, email };
}

/** Add a second person to the org under test. */
async function addMember(userId: string, role = "member") {
  const id = randomUUID();
  await db()
    .insert(orgMembers)
    .values({ id, organization_id: orgId, user_id: userId, role });
  return id;
}

function contextFor(
  user: { id: string; uuid: string },
  role: "owner" | "admin" | "member",
  overrides: Partial<OrgContext> = {}
): OrgContext {
  return {
    userId: user.id,
    userUuid: user.uuid,
    orgId,
    orgUuid: asOrgUuid(orgUuid),
    orgSlug: "team",
    orgName: "Team",
    orgIsPersonal: false,
    role,
    ...overrides,
  };
}

beforeEach(async () => {
  owner = await newUser("owner");
  const org = await ensurePersonalOrganization({ id: owner.id, email: "owner@test.dev" });
  orgId = org.id;
  orgUuid = org.uuid;
});

describeDb("last-owner protection (real database)", () => {
  it("refuses to remove the only owner", async () => {
    const ownerMember = (await db().select().from(orgMembers))[0];

    await expect(
      assertNotLastOwner(orgId, ownerMember.id, "remove")
    ).rejects.toMatchObject({ code: "ORG_LAST_OWNER" });
  });

  it("refuses to demote the only owner", async () => {
    const ownerMember = (await db().select().from(orgMembers))[0];

    await expect(
      assertNotLastOwner(orgId, ownerMember.id, "demote")
    ).rejects.toMatchObject({ code: "ORG_LAST_OWNER" });
  });

  it("allows removing an owner once a second one exists", async () => {
    const colleague = await newUser("colleague");
    await addMember(colleague.id, "owner");

    const ownerMember = (await db().select().from(orgMembers))[0];

    expect(await countOwners(orgId)).toBe(2);
    await expect(assertNotLastOwner(orgId, ownerMember.id, "remove")).resolves.toBeUndefined();
  });

  it("never blocks removing a non-owner", async () => {
    const colleague = await newUser("colleague");
    const memberId = await addMember(colleague.id, "member");

    await expect(assertNotLastOwner(orgId, memberId, "remove")).resolves.toBeUndefined();
  });

  it("reports a member from another organization as not found", async () => {
    const stranger = await newUser("stranger");
    const otherOrg = await ensurePersonalOrganization({
      id: stranger.id,
      email: "stranger@test.dev",
    });

    const [foreignMember] = await db()
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.organization_id, otherOrg.id));

    // Scoped in the lookup, not checked afterwards: a member id from another
    // tenant must resolve to nothing.
    await expect(
      assertNotLastOwner(orgId, foreignMember.id, "remove")
    ).rejects.toMatchObject({ code: "ORG_MEMBER_NOT_FOUND" });
  });
});

describeDb("role assignment rules", () => {
  it("lets an owner grant any role", () => {
    expect(assignableRoles("owner")).toEqual(["owner", "admin", "member"]);
  });

  it("stops an admin from minting an owner", () => {
    // Granting a power you do not hold — including the power to remove you.
    expect(assignableRoles("admin")).not.toContain("owner");
    expect(() => assertCanAssign(contextFor(owner, "admin"), "owner")).toThrow();
    expect(() => assertCanAssign(contextFor(owner, "admin"), "admin")).not.toThrow();
  });

  it("refuses to let someone leave their only organization", async () => {
    // The invariant is that a user always has somewhere to act, not that the
    // workspace carries the `is_personal` flag — a workspace that has since
    // been shared still carries it, and keying on it meant an owner could
    // never remove a teammate they had invited in.
    await expect(assertNotLastOrganization(owner.id)).rejects.toMatchObject({
      code: "ORG_CANNOT_LEAVE_LAST",
    });
  });

  it("allows leaving once the user belongs to a second organization", async () => {
    const second = await newUser("second-home");
    await db().insert(orgMembers).values({
      id: randomUUID(),
      organization_id: (
        await ensurePersonalOrganization({ id: second.id, email: second.email })
      ).id,
      user_id: owner.id,
      role: "member",
    });

    await expect(assertNotLastOrganization(owner.id)).resolves.toBeUndefined();
  });
});

describeDb("team view (real database)", () => {
  it("shows every member with the viewer flagged", async () => {
    const colleague = await newUser("colleague");
    await addMember(colleague.id, "admin");

    const team = await getTeam(contextFor(owner, "owner"));

    expect(team.members).toHaveLength(2);
    expect(team.members.filter((m) => m.isSelf)).toHaveLength(1);
    expect(team.members.find((m) => m.isSelf)?.userUuid).toBe(owner.uuid);
    // Owners first, so the list reads in order of authority.
    expect(team.members[0].role).toBe("owner");
  });

  it("withholds pending invitations from members who cannot manage them", async () => {
    const asMember = await getTeam(contextFor(owner, "member"));
    const asOwner = await getTeam(contextFor(owner, "owner"));

    // Not merely hidden by the UI — the list of addresses somebody tried to
    // invite is neither actionable nor a plain member's business.
    expect(asMember.viewer.canManage).toBe(false);
    expect(asMember.invitations).toEqual([]);
    expect(asOwner.viewer.canManage).toBe(true);
  });

  it("falls back to the email local part when a member has no display name", async () => {
    const team = await getTeam(contextFor(owner, "owner"));

    expect(team.members[0].name).not.toContain("@");
  });
});
