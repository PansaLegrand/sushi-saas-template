import { getAccountActorFromHeaders } from "@/services/account-lifecycle";
import { getAccountSettings } from "@/services/account-settings";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respNoAuth } from "@/lib/resp";
import { respError } from "@/lib/errors/response";

export async function GET(req: Request) {
  const limited = await rateLimitOrThrow(req, "account-read");
  if (limited) return limited;
  try {
    const actor = await getAccountActorFromHeaders(req.headers);
    if (!actor) return respNoAuth();
    return respData(await getAccountSettings(actor));
  } catch (error) { return respError(error, { logFields: { event: "account.settings.read_failed" } }); }
}
