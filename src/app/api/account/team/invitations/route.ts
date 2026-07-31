import { z } from "zod";

import { auth } from "@/lib/auth";
import { parseJsonBody } from "@/lib/http/request";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respForbidden, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { can, getOrgContext } from "@/services/authz";
import { assertCanAssign, getTeam } from "@/services/members";
import {
  assertOrganizationCanInvite,
  serializeOrganizationSeatMutation,
} from "@/services/organization-seats";

const InviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["owner", "admin", "member"]).default("member"),
});

/**
 * Invite someone to the current organization.
 *
 * Rate limited on the auth bucket rather than a read bucket: this endpoint
 * causes mail to be sent to an address the caller chose, which is a spam vector
 * with someone else's inbox on the receiving end.
 */
export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "auth");
  if (limited) return limited;

  try {
    const ctx = await getOrgContext(req);
    if (!ctx) return respNoAuth();

    if (!can(ctx, "member:manage")) return respForbidden();

    const payload = await parseJsonBody(req, InviteSchema);

    // An admin cannot mint an owner: that would be granting a power they do not
    // hold, including the power to remove them.
    assertCanAssign(ctx, payload.role);

    // Inviting yourself is always a mistake, and the plugin's own error for it
    // is less clear than saying so directly.
    if (payload.email === (await currentEmail(req))) {
      return respCode("ORG_ALREADY_MEMBER");
    }

    // Count both members and live pending invitations. The plugin's own
    // membershipLimit protects acceptance, but pending links reserve seats so
    // reaching the cap must stop before another email is queued.
    await serializeOrganizationSeatMutation(ctx.orgId, async () => {
      await assertOrganizationCanInvite(ctx.orgId, ctx.orgUuid, {
        replacingEmail: payload.email,
      });

      await auth.api.createInvitation({
        headers: req.headers,
        body: {
          email: payload.email,
          role: payload.role,
          organizationId: ctx.orgId,
        },
      });
    });

    // Return the refreshed team so the client re-renders from server truth
    // rather than optimistically inserting a row it guessed the shape of.
    return respData(await getTeam(ctx));
  } catch (error) {
    return respError(error, {
      logFields: { event: "team.invite_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}

async function currentEmail(req: Request): Promise<string | undefined> {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user.email?.toLowerCase();
}
