import { respError } from "@/lib/errors/response";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respNoAuth } from "@/lib/resp";
import {
  getAccountActorFromHeaders,
  getLatestAccountExport,
  requestAccountDataExport,
  validateAccountLifecycleIdempotencyKey,
} from "@/services/account-lifecycle";

export async function GET(req: Request) {
  const limited = await rateLimitOrThrow(req, "account-read");
  if (limited) return limited;
  try {
    const actor = await getAccountActorFromHeaders(req.headers);
    if (!actor) return respNoAuth();
    return respData(await getLatestAccountExport(actor));
  } catch (error) { return respError(error, { logFields: { event: "account.export.latest_failed" }, fallback: "ACCOUNT_EXPORT_FAILED" }); }
}

export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "auth-sensitive");
  if (limited) return limited;

  try {
    const actor = await getAccountActorFromHeaders(req.headers);
    if (!actor) return respNoAuth();

    const idempotencyKey = validateAccountLifecycleIdempotencyKey(
      req.headers.get("Idempotency-Key"),
    );
    const request = await requestAccountDataExport({
      actor,
      idempotencyKey,
    });
    return respData(request, { status: 202 });
  } catch (error) {
    return respError(error, {
      logFields: { event: "account.data_export.request_failed" },
      fallback: "ACCOUNT_EXPORT_FAILED",
    });
  }
}
