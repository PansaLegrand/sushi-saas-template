import { respData, respErr, respNoAuth } from "@/lib/resp";
import { getTasksByUserUuid } from "@/models/task";
import { getUserUuid } from "@/services/user";

export async function GET(req: Request) {
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
    console.error("get latest task failed", error);
    return respErr("get latest task failed", { status: 500 });
  }
}

