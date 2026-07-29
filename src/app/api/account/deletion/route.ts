import { respError } from "@/lib/errors/response";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respNoAuth } from "@/lib/resp";
import {
  cancelAccountErasure,
  getAccountActorFromHeaders,
  getAccountErasureStatus,
  requestAccountErasure,
  validateAccountLifecycleIdempotencyKey,
} from "@/services/account-lifecycle";

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
    return respData(
      await requestAccountErasure({ actor, idempotencyKey }),
      { status: 202 },
    );
  } catch (error) {
    return respError(error, {
      logFields: { event: "account.deletion.request_failed" },
      fallback: "ACCOUNT_LIFECYCLE_FAILED",
    });
  }
}
export async function GET(req: Request) {
  const limited = await rateLimitOrThrow(req, "auth-sensitive");
  if (limited) return limited;

  try {
    const actor = await getAccountActorFromHeaders(req.headers);
    if (!actor) return respNoAuth();
    return respData(await getAccountErasureStatus(actor));
  } catch (error) {
    return respError(error, {
      logFields: { event: "account.deletion.status_failed" },
      fallback: "ACCOUNT_LIFECYCLE_FAILED",
    });
  }
}

export async function DELETE(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "auth-sensitive");
  if (limited) return limited;

  try {
    const actor = await getAccountActorFromHeaders(req.headers);
    if (!actor) return respNoAuth();
    return respData(await cancelAccountErasure(actor));
  } catch (error) {
    return respError(error, {
      logFields: { event: "account.deletion.cancel_failed" },
      fallback: "ACCOUNT_LIFECYCLE_FAILED",
    });
  }
}
