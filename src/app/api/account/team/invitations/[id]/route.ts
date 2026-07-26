import { auth } from "@/lib/auth";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respForbidden, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { can, getOrgContext } from "@/services/authz";
import { getTeam } from "@/services/members";
import { listPendingInvitations } from "@/models/organization";

/** Withdraw a pending invitation. */
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

    if (!can(ctx, "member:manage")) return respForbidden();

    const { id } = await route.params;

    // Proven to belong to the caller's organization before it is touched. The
    // plugin checks permissions against the invitation's own org, so without
    // this an admin of one team could cancel another team's invitation by id.
    const pending = await listPendingInvitations(ctx.orgId);
    if (!pending.some((invitation) => invitation.id === id)) {
      return respCode("ORG_INVITATION_NOT_FOUND");
    }

    await auth.api.cancelInvitation({
      headers: req.headers,
      body: { invitationId: id },
    });

    return respData(await getTeam(ctx));
  } catch (error) {
    return respError(error, {
      logFields: { event: "team.invitation_cancel_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
