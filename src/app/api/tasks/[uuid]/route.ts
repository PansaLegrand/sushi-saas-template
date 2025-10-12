import { respData, respErr, respForbidden, respNoAuth, respNotFound } from "@/lib/resp";
import { findTaskByUuid } from "@/models/task";
import { getUserUuid } from "@/services/user";

export async function GET(req: Request, ctx: { params: Promise<{ uuid: string }> }) {
  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) return respNoAuth();

    const { uuid } = await ctx.params;
    if (!uuid) return respErr("invalid params");

    const task = await findTaskByUuid(uuid);
    if (!task) return respNotFound("task not found");
    if (task.user_uuid !== userUuid) return respForbidden();

    return respData({
      task: {
        uuid: task.uuid,
        userUuid: task.user_uuid,
        type: task.type,
        status: task.status,
        creditsUsed: task.credits_used,
        creditsTransNo: task.credits_trans_no ?? undefined,
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
    console.error("get task failed", error);
    return respErr("get task failed", { status: 500 });
  }
}
