import { respData, respErr, respNoAuth } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { createTextToVideoTask } from "@/services/tasks";
import type { CreateTextToVideoRequest, CreateTextToVideoResponse } from "@/types/task";

export async function POST(req: Request) {
  try {
    const userUuid = await getUserUuid(req);
    if (!userUuid) return respNoAuth();

    let payload: CreateTextToVideoRequest | undefined;
    try {
      payload = (await req.json()) as CreateTextToVideoRequest;
    } catch (e) {
      return respErr("invalid params");
    }

    if (!payload?.prompt || typeof payload.prompt !== "string") {
      return respErr("prompt is required");
    }

    const seconds = Math.max(1, Number(payload.seconds ?? 8));
    const aspectRatio = payload.aspectRatio ?? "landscape";

    const { task } = await createTextToVideoTask({
      userUuid,
      input: { prompt: payload.prompt, seconds, aspectRatio },
    });

    const data: CreateTextToVideoResponse = {
      task: {
        uuid: task.uuid,
        userUuid: task.user_uuid,
        type: task.type,
        status: task.status as any,
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
    };

    return respData(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "create task failed";
    if (message === "insufficient credits") {
      return respErr("insufficient credits");
    }
    console.error("create text-to-video task failed", error);
    return respErr("create task failed", { status: 500 });
  }
}
