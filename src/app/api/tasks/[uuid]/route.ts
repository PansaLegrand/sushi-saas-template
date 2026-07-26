import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { findTaskByUuid } from "@/models/task";
import { getOrgContext } from "@/services/authz";

export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  const limited = await rateLimitOrThrow(req, "tasks");
  if (limited) return limited;

  try {
    const org = await getOrgContext(req);
    if (!org) return respNoAuth();

    const { uuid } = await ctx.params;
    if (!uuid) return respCode("REQUEST_MISSING_FIELD", {
      details: { field: "uuid" },
    });

    const task = await findTaskByUuid(uuid, org.orgUuid);
    if (!task) return respCode("TASK_NOT_FOUND");

    return respData({
      task: {
        uuid: task.uuid,
        userUuid: task.user_uuid,
        type: task.type,
        status: task.status,
        creditsUsed: task.credits_used,
        creditsTransNo: task.credits_trans_no ?? undefined,
        idempotencyKey: task.idempotency_key ?? undefined,
        userInput: task.user_input ?? undefined,
        outputUrl: task.output_url ?? undefined,
        outputJson: task.output_json ?? undefined,
        errorMessage: task.error_message ?? undefined,
        startedAt: task.started_at?.toISOString() ?? null,
        completedAt: task.completed_at?.toISOString() ?? null,
        createdAt: task.created_at?.toISOString() ?? new Date().toISOString(),
        updatedAt: task.updated_at?.toISOString() ?? new Date().toISOString(),
      },
    });
  } catch (error) {
    return respError(error, {
      logFields: { event: "task.get_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
