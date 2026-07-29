import { z } from "zod";

import { parseJsonBody } from "@/lib/http/request";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respForbidden, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { findMembershipById } from "@/models/organization";
import { can, getOrgContext } from "@/services/authz";
import {
  assertCanAssign,
  changeMemberRole,
  getTeam,
  removeMember,
} from "@/services/members";

const RoleSchema = z.object({
  role: z.enum(["owner", "admin", "member"]),
});

/** Change a member's role. */
export async function PATCH(
  req: Request,
  route: { params: Promise<{ id: string }> }
) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "auth");
  if (limited) return limited;

  try {
    const ctx = await getOrgContext(req);
    if (!ctx) return respNoAuth();
    if (!can(ctx, "member:manage")) return respForbidden();

    const { id } = await route.params;
    const payload = await parseJsonBody(req, RoleSchema);

    assertCanAssign(ctx, payload.role);

    const member = await findMembershipById(ctx.orgId, id);
    if (!member) return respCode("ORG_MEMBER_NOT_FOUND");

    await changeMemberRole(ctx.orgId, id, payload.role);

    return respData(await getTeam(ctx));
  } catch (error) {
    return respError(error, {
      logFields: { event: "team.role_change_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}

/**
 * Remove a member, or leave the organization yourself.
 *
 * One handler for both because they are the same row disappearing, and the
 * rules that matter — never strip the last owner, never empty a personal
 * workspace — apply identically either way. Splitting them into two endpoints
 * would mean writing those checks twice, and the second copy is where they
 * drift.
 */
export async function DELETE(
  req: Request,
  route: { params: Promise<{ id: string }> }
) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "auth");
  if (limited) return limited;

  try {
    const ctx = await getOrgContext(req);
    if (!ctx) return respNoAuth();

    const { id } = await route.params;

    const member = await findMembershipById(ctx.orgId, id);
    if (!member) return respCode("ORG_MEMBER_NOT_FOUND");

    const isSelf = member.user_id === ctx.userId;

    // Anyone may leave; only a manager may remove somebody else.
    if (!isSelf && !can(ctx, "member:manage")) return respForbidden();

    // The service performs the owner and last-organization checks in the same
    // locked transaction as the delete. A preflight query here would reopen the
    // race this endpoint exists to prevent.
    await removeMember(ctx.orgId, id);

    // Leaving means the caller is no longer in this organization, so there is
    // no team left to return — the client redirects instead of re-rendering.
    if (isSelf) return respData({ left: true });

    return respData(await getTeam(ctx));
  } catch (error) {
    return respError(error, {
      logFields: { event: "team.member_remove_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
