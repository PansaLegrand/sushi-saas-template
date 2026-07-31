import { auth } from "@/lib/auth";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { asOrgUuid, findInvitationById } from "@/models/organization";
import {
  assertOrganizationCanAcceptInvitation,
  serializeOrganizationSeatMutation,
} from "@/services/organization-seats";

/**
 * Accept or decline an invitation.
 *
 * Not under `/team` because the caller is not yet a member of the organization
 * in question — there is no team context to resolve. The invitation id is the
 * only credential, so everything below re-derives trust from the session rather
 * than from the URL.
 */
export async function POST(
  req: Request,
  route: { params: Promise<{ id: string }> }
) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "auth");
  if (limited) return limited;

  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return respNoAuth();

    const { id } = await route.params;
    const invitation = await findInvitationById(id);

    if (!invitation || invitation.status !== "pending") {
      return respCode("ORG_INVITATION_NOT_FOUND");
    }

    if (invitation.expires_at.getTime() <= Date.now()) {
      return respCode("ORG_INVITATION_EXPIRED");
    }

    // The link is a bearer token: anyone holding it can replay it. Binding
    // acceptance to the invited address is what stops a forwarded email from
    // adding the wrong person to a team.
    if (invitation.email.toLowerCase() !== session.user.email?.toLowerCase()) {
      return respCode("ORG_INVITATION_WRONG_ACCOUNT");
    }

    // The plan or an admin exception may have changed since the link was sent.
    // Existing members survive a downgrade; this new membership does not.
    const accepted = await serializeOrganizationSeatMutation(
      invitation.organization.id,
      async () => {
        await assertOrganizationCanAcceptInvitation(
          invitation.organization.id,
          asOrgUuid(invitation.organization.uuid),
        );

        return auth.api.acceptInvitation({
          headers: req.headers,
          body: { invitationId: id },
        });
      },
    );

    return respData({ organizationId: accepted?.invitation?.organizationId ?? null });
  } catch (error) {
    return respError(error, {
      logFields: { event: "invitation.accept_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}

/** Decline. Separate verb so a mis-click cannot be replayed into an accept. */
export async function DELETE(
  req: Request,
  route: { params: Promise<{ id: string }> }
) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "auth");
  if (limited) return limited;

  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return respNoAuth();

    const { id } = await route.params;
    const invitation = await findInvitationById(id);

    if (!invitation || invitation.status !== "pending") {
      return respCode("ORG_INVITATION_NOT_FOUND");
    }

    if (invitation.email.toLowerCase() !== session.user.email?.toLowerCase()) {
      return respCode("ORG_INVITATION_WRONG_ACCOUNT");
    }

    await auth.api.rejectInvitation({
      headers: req.headers,
      body: { invitationId: id },
    });

    return respData({ declined: true });
  } catch (error) {
    return respError(error, {
      logFields: { event: "invitation.decline_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
