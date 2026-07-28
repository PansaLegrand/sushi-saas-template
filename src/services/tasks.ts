import { getSnowId } from "@/lib/hash";
import { isTextToVideoMockEnabled } from "@/lib/demo-flags";
import { logger } from "@/lib/logger/server";
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
import { AppError, toAppError } from "@/lib/errors/app-error";

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
  /** The tenant the task and its credit spend belong to. */
  orgUuid: string;
  /** The member who ran it. */
  userUuid: string;
  input: TextToVideoInput;
  idempotencyKey?: string;
}): Promise<{
  task: typeof import("@/db/schema").tasks.$inferSelect;
}> {
  const { orgUuid, userUuid, input } = params;

  const seconds = Number.isFinite(input.seconds as number) ? (input.seconds as number) : 8;
  const aspectRatio = input.aspectRatio ?? "landscape";
  const creditsUsed = calculateTextToVideoCost({ seconds, aspectRatio });

  if (!isTextToVideoMockEnabled()) {
    throw new AppError("FEATURE_DISABLED", {
      message: "text-to-video demo provider is disabled",
    });
  }

  const normalizedInput = {
    prompt: input.prompt,
    seconds,
    aspect_ratio: aspectRatio,
  };
  const idempotencyKey = params.idempotencyKey?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new AppError("REQUEST_INVALID", {
      message: `idempotency key too long: ${idempotencyKey.length}`,
      details: { field: "idempotencyKey", max: MAX_IDEMPOTENCY_KEY_LENGTH },
    });
  }

  const now = new Date();
  const uuid = getSnowId();

  const insertedTask = await insertTaskForIdempotencyKey({
    uuid,
    org_uuid: orgUuid,
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
      throw new AppError("TASK_CREATE_FAILED", {
        message: "failed to insert task without idempotency key",
      });
    }

    const existingTask = await findTaskByIdempotencyKey({
      org_uuid: orgUuid,
      user_uuid: userUuid,
      type: TASK_TYPE_TEXT_TO_VIDEO,
      idempotency_key: idempotencyKey,
    });

    if (!existingTask) {
      throw new AppError("TASK_CREATE_FAILED", {
        message: "failed to load idempotent task after insert conflict",
      });
    }

    return { task: existingTask };
  }

  let transNo: string | undefined;
  try {
    transNo = await decreaseCredits({
      org_uuid: orgUuid,
      user_uuid: userUuid,
      trans_type: CreditsTransType.TaskTextToVideo,
      credits: creditsUsed,
      actor: `user:${userUuid}`,
      // What the spend bought. The task also records `credits_trans_no`, but
      // only this direction survives the task row being pruned.
      metadata: { task_uuid: insertedTask.uuid },
    });

    await updateTaskStatus(insertedTask.uuid, orgUuid, "running", {
      credits_trans_no: transNo,
    });

    const result = await generateTextToVideo({
      prompt: input.prompt,
      seconds,
      aspectRatio,
    });

    const task = await updateTaskStatus(insertedTask.uuid, orgUuid, "succeeded", {
      output_url: result.outputUrl,
      output_json: result.raw ? JSON.stringify(result.raw) : null,
      completed_at: new Date(),
    });

    if (!task) {
      throw new AppError("TASK_CREATE_FAILED", {
        message: `failed to mark task ${insertedTask.uuid} as succeeded`,
      });
    }

    return { task };
  } catch (error) {
    const appError = toAppError(error, "TASK_PROVIDER_FAILED");

    if (transNo) {
      try {
        await refundCreditsForTransaction({
          org_uuid: orgUuid,
          user_uuid: userUuid,
          original_trans_no: transNo,
        });
      } catch (refundError) {
        logger.error(
          {
            err: refundError,
            org_uuid: orgUuid,
            user_uuid: userUuid,
            trans_no: transNo,
            task_uuid: insertedTask.uuid,
          },
          "refund text-to-video credits failed"
        );
      }
    }

    await updateTaskStatus(insertedTask.uuid, orgUuid, "failed", {
      credits_trans_no: transNo,
      error_message: appError.code,
      completed_at: new Date(),
    });

    throw appError;
  }
}
