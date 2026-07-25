import { isCreditsPlaygroundEnabled } from "@/lib/demo-flags";
import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { getTasksByUserUuid } from "@/models/task";
import { getUserUuid } from "@/services/user";

export async function GET(req: Request) {
  if (!isCreditsPlaygroundEnabled()) {
    return respCode("RESOURCE_NOT_FOUND");
  }

  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) return respNoAuth();

    const tasks = await getTasksByUserUuid(userUuid, 1, 1);
    const task = tasks && tasks.length > 0 ? tasks[0] : null;

    return respData({
      task: task
        ? {
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
          }
        : null,
    });
  } catch (error) {
    return respError(error, {
      logFields: { event: "task.latest_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
