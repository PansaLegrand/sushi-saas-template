import { getSnowId } from "@/lib/hash";
import { isTextToVideoMockEnabled } from "@/lib/demo-flags";
import {
  findTaskByIdempotencyKey,
  insertTaskForIdempotencyKey,
  updateTaskStatus,
} from "@/models/task";
import {
  CreditsTransType,
  decreaseCredits,
  refundCreditsForTransaction,
} from "@/services/credit";
import { generateTextToVideo, type TextToVideoInput } from "@/services/ai/video";
import { TEXT2VIDEO_COST } from "@/config/tasks";

export const TASK_TYPE_TEXT_TO_VIDEO = "text_to_video" as const;
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export function calculateTextToVideoCost(params: {
  seconds: number;
  aspectRatio: string;
}): number {
  const aspect = (params.aspectRatio || "landscape").toLowerCase();
  const mux =
    aspect === "portrait"
      ? TEXT2VIDEO_COST.MULTIPLIER.portrait
      : aspect === "square"
      ? TEXT2VIDEO_COST.MULTIPLIER.square
      : TEXT2VIDEO_COST.MULTIPLIER.landscape;

  const base = Math.max(1, TEXT2VIDEO_COST.CREDITS_PER_SECOND) * Math.max(1, Math.round(params.seconds));
  const cost = Math.ceil(base * Math.max(0.1, mux));
  return Math.max(TEXT2VIDEO_COST.MIN_CREDITS, cost);
}

export async function createTextToVideoTask(params: {
  userUuid: string;
  input: TextToVideoInput;
  idempotencyKey?: string;
}): Promise<{
  task: typeof import("@/db/schema").tasks.$inferSelect;
}> {
  const { userUuid, input } = params;

  const seconds = Number.isFinite(input.seconds as number) ? (input.seconds as number) : 8;
  const aspectRatio = input.aspectRatio ?? "landscape";
  const creditsUsed = calculateTextToVideoCost({ seconds, aspectRatio });

  if (!isTextToVideoMockEnabled()) {
    throw new Error("text-to-video demo provider is disabled");
  }

  const normalizedInput = {
    prompt: input.prompt,
    seconds,
    aspect_ratio: aspectRatio,
  };
  const idempotencyKey = params.idempotencyKey?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new Error("idempotency key too long");
  }

  const now = new Date();
  const uuid = getSnowId();

  const insertedTask = await insertTaskForIdempotencyKey({
    uuid,
    user_uuid: userUuid,
    type: TASK_TYPE_TEXT_TO_VIDEO,
    status: "running",
    credits_used: creditsUsed,
    idempotency_key: idempotencyKey,
    user_input: JSON.stringify(normalizedInput),
    created_at: now,
    updated_at: now,
    started_at: now,
  });

  if (!insertedTask) {
    if (!idempotencyKey) {
      throw new Error("failed to insert task");
    }

    const existingTask = await findTaskByIdempotencyKey({
      user_uuid: userUuid,
      type: TASK_TYPE_TEXT_TO_VIDEO,
      idempotency_key: idempotencyKey,
    });

    if (!existingTask) {
      throw new Error("failed to load idempotent task");
    }

    return { task: existingTask };
  }

  let transNo: string | undefined;
  try {
    transNo = await decreaseCredits({
      user_uuid: userUuid,
      trans_type: CreditsTransType.TaskTextToVideo,
      credits: creditsUsed,
    });

    await updateTaskStatus(insertedTask.uuid, "running", {
      credits_trans_no: transNo,
    });

    const result = await generateTextToVideo({
      prompt: input.prompt,
      seconds,
      aspectRatio,
    });

    const task = await updateTaskStatus(insertedTask.uuid, "succeeded", {
      output_url: result.outputUrl,
      output_json: result.raw ? JSON.stringify(result.raw) : null,
      completed_at: new Date(),
    });

    if (!task) {
      throw new Error("failed to update task");
    }

    return { task };
  } catch (error) {
    if (transNo) {
      try {
        await refundCreditsForTransaction({
          user_uuid: userUuid,
          original_trans_no: transNo,
        });
      } catch (refundError) {
        console.error("refund text-to-video credits failed", refundError);
      }
    }

    const message = error instanceof Error ? error.message : "create task failed";
    await updateTaskStatus(insertedTask.uuid, "failed", {
      credits_trans_no: transNo,
      error_message: message,
      completed_at: new Date(),
    });

    throw error;
  }
}
