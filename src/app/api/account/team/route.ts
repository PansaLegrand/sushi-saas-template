import { respData, respNoAuth } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { getOrgContext } from "@/services/authz";
import { getTeam } from "@/services/members";

/**
 * The team the caller is currently acting in: members, roles, and — for those
 * who can manage them — pending invitations.
 *
 * A read, so no origin check and no rate limit, matching `/api/account/plan`.
 */
export async function GET(req: Request) {
  try {
    const ctx = await getOrgContext(req);
    if (!ctx) return respNoAuth();

    return respData(await getTeam(ctx));
  } catch (error) {
    return respError(error, {
      logFields: { event: "team.read_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
