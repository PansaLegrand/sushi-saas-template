import { isTextToVideoMockEnabled } from "@/lib/demo-flags";
import { requireSameOrigin } from "@/lib/origin";
import { respData, respErr, respNoAuth, respNotFound } from "@/lib/resp";
import { respError } from "@/lib/errors/response";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { getUserUuid } from "@/services/user";
import { createTextToVideoTask } from "@/services/tasks";
import type { CreateTextToVideoRequest, CreateTextToVideoResponse } from "@/types/task";

export async function POST(req: Request) {
  if (!isTextToVideoMockEnabled()) {
    return respNotFound("not found");
  }

  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "tasks");
  if (limited) return limited;

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
    const idempotencyKey =
      typeof payload.idempotencyKey === "string"
        ? payload.idempotencyKey
        : req.headers.get("idempotency-key") ?? undefined;

    const { task } = await createTextToVideoTask({
      userUuid,
      input: { prompt: payload.prompt, seconds, aspectRatio },
      idempotencyKey,
    });

    const data: CreateTextToVideoResponse = {
      task: {
        uuid: task.uuid,
        userUuid: task.user_uuid,
        type: task.type,
        status: task.status as any,
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
    };

    return respData(data);
  } catch (error) {
    // toAppError maps known throws ("insufficient credits" -> CREDITS_INSUFFICIENT
    // via the catalog's legacy aliases), so the branching on message text that
    // used to live here is gone. Anything unrecognized becomes TASK_CREATE_FAILED
    // with its real message going only to the log.
    return respError(error, {
      logFields: { event: "task.text_to_video.create_failed" },
      fallback: "TASK_CREATE_FAILED",
    });
  }
}
