import { z } from "zod";
import { getAccountActorFromHeaders } from "@/services/account-lifecycle";
import { revokeAccountSessions } from "@/services/account-settings";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/http/request";
import { respData, respNoAuth } from "@/lib/resp";
import { respError } from "@/lib/errors/response";

const Action = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("others") }),
  z.object({ scope: z.literal("session"), reference: z.string().regex(/^[a-f0-9]{64}$/) }),
]);
export async function DELETE(req: Request) {
  const invalid = requireSameOrigin(req);
  if (invalid) return invalid;
  const limited = await rateLimitOrThrow(req, "auth-sensitive");
  if (limited) return limited;
  try {
    const actor = await getAccountActorFromHeaders(req.headers);
    if (!actor) return respNoAuth();
    const action = await parseJsonBody(req, Action);
    return respData(await revokeAccountSessions(actor, req.headers, action));
  } catch (error) { return respError(error, { logFields: { event: "account.sessions.revoke_failed" } }); }
}
