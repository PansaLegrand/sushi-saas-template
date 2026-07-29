import { AppError } from "@/lib/errors/app-error";
import {
  countOwners,
  findMembershipById,
  findMembershipsByUserId,
  listMembersWithUsers,
  listPendingInvitations,
  removeMemberAtomically,
  updateMemberRoleAtomically,
  type OrgRoleValue,
} from "@/models/organization";

import type { TeamView } from "@/types/team";

import { can, type OrgContext } from "./authz";

/**
 * Team membership, and the rules the organization plugin does not know about.
 *
 * Better Auth owns the mechanics — creating invitations, accepting them,
 * deleting membership rows. What it cannot know is which of those operations
 * would leave *this* product in a broken state. Two such rules live here, and
 * both exist because the obvious implementation quietly destroys an account:
 *
 *   1. An organization must never lose its last owner. Nobody could then
 *      invite, remove, change a role, or manage billing, and no self-serve path
 *      recovers from it — it is a support ticket that can only be closed with
 *      SQL.
 *   2. A personal workspace cannot be left or emptied. It is the fallback
 *      `getOrgContext()` lands on, so a user without one has an account that
 *      loads nothing.
 */

// The wire shape lives in `@/types/team` so `src/api/` can import it without
// reaching into the service layer. This module produces it; the browser
// consumes it.
export type { InvitationView, MemberView, TeamView } from "@/types/team";

/**
 * Everything the team screen renders, in one round trip.
 *
 * Pending invitations are included only for members who can manage them: to
 * everyone else the list of addresses someone tried to invite is neither
 * actionable nor their business.
 */
export async function getTeam(ctx: OrgContext): Promise<TeamView> {
  const canManage = can(ctx, "member:manage");

  const [members, invitations] = await Promise.all([
    listMembersWithUsers(ctx.orgId),
    canManage ? listPendingInvitations(ctx.orgId) : Promise.resolve([]),
  ]);

  return {
    organization: {
      uuid: ctx.orgUuid,
      name: ctx.orgName,
      slug: ctx.orgSlug,
      isPersonal: ctx.orgIsPersonal,
    },
    viewer: { role: ctx.role, canManage },
    members: members.map((row) => ({
      memberId: row.member.id,
      userUuid: row.user.uuid,
      email: row.user.email,
      name: row.user.nickname || row.user.email.split("@")[0],
      role: row.member.role as OrgRoleValue,
      joinedAt: row.member.created_at?.toISOString() ?? null,
      isSelf: row.user.id === ctx.userId,
    })),
    invitations: invitations.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expires_at?.toISOString() ?? null,
    })),
  };
}

/**
 * Refuse changes that would strip an organization of its last owner.
 *
 * Called before both role changes and removals. `countOwners` runs against the
 * database rather than a cached list because the caller's view of the team may
 * be seconds old, and two admins demoting the last two owners concurrently is
 * exactly the race this is here to lose safely.
 */
export async function assertNotLastOwner(
  orgId: string,
  memberId: string,
  action: "remove" | "demote"
): Promise<void> {
  const member = await findMembershipById(orgId, memberId);
  if (!member) {
    throw new AppError("ORG_MEMBER_NOT_FOUND", {
      message: `member ${memberId} is not in organization ${orgId}`,
    });
  }

  if (member.role !== "owner") return;

  const owners = await countOwners(orgId);
  if (owners <= 1) {
    throw new AppError("ORG_LAST_OWNER", {
      message: `refusing to ${action} the last owner of organization ${orgId}`,
    });
  }
}

/**
 * Refuse to let someone leave their last organization.
 *
 * The guard used to key on `is_personal`, which was wrong in both directions:
 * a personal workspace that someone had been invited into was still flagged
 * personal, so its owner could never remove the teammate they had just added —
 * and the flag says nothing about whether the *leaver* has anywhere else to go.
 * The invariant that actually matters is that every user always has at least
 * one organization, because `getOrgContext()` has to land somewhere.
 */
export async function assertNotLastOrganization(userId: string): Promise<void> {
  const memberships = await findMembershipsByUserId(userId);

  if (memberships.length <= 1) {
    throw new AppError("ORG_CANNOT_LEAVE_LAST", {
      message: `user ${userId} would be left with no organization`,
    });
  }
}

/** The roles a caller may hand out. Nobody can grant above their own level. */
export function assignableRoles(role: OrgRoleValue): OrgRoleValue[] {
  // An admin promoting someone to owner would be granting a power they do not
  // have, including the power to remove them.
  return role === "owner" ? ["owner", "admin", "member"] : ["admin", "member"];
}

export function assertCanAssign(ctx: OrgContext, role: string): void {
  if (!assignableRoles(ctx.role).includes(role as OrgRoleValue)) {
    throw new AppError("AUTH_FORBIDDEN", {
      message: `${ctx.role} may not assign the role ${role}`,
    });
  }
}

/** Change a role through the database-serialized membership invariant. */
export async function changeMemberRole(
  orgId: string,
  memberId: string,
  role: OrgRoleValue
): Promise<void> {
  const outcome = await updateMemberRoleAtomically(orgId, memberId, role);

  switch (outcome.status) {
    case "updated":
      return;
    case "not-found":
      throw new AppError("ORG_MEMBER_NOT_FOUND", {
        message: `member ${memberId} is not in organization ${orgId}`,
      });
    case "last-owner":
      throw new AppError("ORG_LAST_OWNER", {
        message: `refusing to demote the last owner of organization ${orgId}`,
      });
    default:
      throw new AppError("SERVER_ERROR", {
        message: `unexpected role mutation outcome: ${outcome.status}`,
      });
  }
}

/** Remove a member through the database-serialized membership invariants. */
export async function removeMember(
  orgId: string,
  memberId: string
): Promise<void> {
  const outcome = await removeMemberAtomically(orgId, memberId);

  switch (outcome.status) {
    case "removed":
      return;
    case "not-found":
      throw new AppError("ORG_MEMBER_NOT_FOUND", {
        message: `member ${memberId} is not in organization ${orgId}`,
      });
    case "last-owner":
      throw new AppError("ORG_LAST_OWNER", {
        message: `refusing to remove the last owner of organization ${orgId}`,
      });
    case "last-organization":
      throw new AppError("ORG_CANNOT_LEAVE_LAST", {
        message: `member ${memberId} would be left with no organization`,
      });
    default:
      throw new AppError("SERVER_ERROR", {
        message: `unexpected removal outcome: ${outcome.status}`,
      });
  }
}
