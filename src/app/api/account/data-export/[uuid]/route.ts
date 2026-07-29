import { respError } from "@/lib/errors/response";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respNoAuth } from "@/lib/resp";
import {
  getAccountActorFromHeaders,
  getAccountExportStatus,
} from "@/services/account-lifecycle";

export async function GET(
  req: Request,
  route: { params: Promise<{ uuid: string }> },
) {
  const limited = await rateLimitOrThrow(req, "auth-sensitive");
  if (limited) return limited;

  try {
    const actor = await getAccountActorFromHeaders(req.headers);
    if (!actor) return respNoAuth();

    const { uuid } = await route.params;
    return respData(
      await getAccountExportStatus({ actor, requestUuid: uuid }),
    );
  } catch (error) {
    return respError(error, {
      logFields: { event: "account.data_export.status_failed" },
      fallback: "ACCOUNT_EXPORT_FAILED",
    });
  }
}
