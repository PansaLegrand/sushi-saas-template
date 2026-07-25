import { respData, respNoAuth } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { getPlanSnapshot } from "@/services/entitlements";
import { getUserUuid } from "@/services/user";

/**
 * The signed-in user's current plan.
 *
 * A read, so no origin check and no rate limit bucket: it exposes nothing the
 * session does not already grant, and gating it would only make the account
 * screens flakier.
 *
 * Server Components should call `getPlanSnapshot` directly instead of fetching
 * this — see the frontend rules in AGENTS.md. This endpoint exists for client
 * components that mount without a server-rendered snapshot.
 */
export async function GET(req: Request) {
  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) {
      return respNoAuth();
    }

    return respData(await getPlanSnapshot(userUuid));
  } catch (error) {
    return respError(error, {
      logFields: { event: "account.plan_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
