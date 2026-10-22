import { createHash } from "node:crypto";
import { AppError, toAppError } from "@/lib/errors";
import { isTextToVideoMockEnabled } from "@/lib/demo-flags";
import { newId } from "@/lib/ids";
import { startOfUtcMonth } from "@/lib/time";
import { asOrgUuid } from "@/models/organization";
import { admitPaidTask } from "@/models/task-admission";
import {
  findTaskByIdempotencyKey,
  findTaskByUuid,
  transitionTaskStatus,
  type TaskRow,
} from "@/models/task";
import {
  requireEntitlement,
  limitOf,
  enforceLimit,
} from "@/services/entitlements";
import {
  CreditsTransType,
  refundCreditsForTransaction,
} from "@/services/credit";
import {
  generateTextToVideo,
  type TextToVideoInput,
} from "@/services/ai/video";
import { assertJobActive } from "@/services/jobs/execution";
import type { JobHandlerContext } from "@/services/jobs/types";
import {
  TEXT2VIDEO_COST,
  TEXT2VIDEO_JOB_ATTEMPTS,
  TEXT2VIDEO_PROVIDER_ATTEMPTS,
} from "@/config/tasks";

export const TASK_TYPE_TEXT_TO_VIDEO = "text_to_video" as const;

export function calculateTextToVideoCost(params: {
  seconds: number;
  aspectRatio: string;
}): number {
  const aspect = (params.aspectRatio || "landscape").toLowerCase();
  const multiplier =
    aspect === "portrait"
      ? TEXT2VIDEO_COST.MULTIPLIER.portrait
      : aspect === "square"
        ? TEXT2VIDEO_COST.MULTIPLIER.square
        : TEXT2VIDEO_COST.MULTIPLIER.landscape;
  const base =
    Math.max(1, TEXT2VIDEO_COST.CREDITS_PER_SECOND) *
    Math.max(1, Math.round(params.seconds));
  return Math.max(
    TEXT2VIDEO_COST.MIN_CREDITS,
    Math.ceil(base * Math.max(0.1, multiplier)),
  );
}

export async function createTextToVideoTask(params: {
  orgUuid: string;
  userUuid: string;
  input: TextToVideoInput;
  idempotencyKey?: string;
}): Promise<{ task: TaskRow }> {
  if (!isTextToVideoMockEnabled()) throw new AppError("FEATURE_DISABLED");
  const prompt = params.input.prompt.trim();
  const seconds = params.input.seconds ?? 8;
  const aspectRatio = params.input.aspectRatio ?? "landscape";
  const key = params.idempotencyKey?.trim();
  if (!key)
    throw new AppError("REQUEST_MISSING_FIELD", {
      details: { field: "idempotencyKey" },
    });
  if (!prompt) throw new AppError("TASK_PROMPT_REQUIRED");
  if (
    key.length > 255 ||
    prompt.length > 1_000 ||
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > 60 ||
    !["landscape", "portrait", "square"].includes(aspectRatio)
  )
    throw new AppError("REQUEST_INVALID");
  const input = JSON.stringify({ prompt, seconds, aspect_ratio: aspectRatio });
  const fingerprint = createHash("sha256").update(input).digest("hex");
  const existing = await findTaskByIdempotencyKey({
    org_uuid: params.orgUuid,
    user_uuid: params.userUuid,
    type: TASK_TYPE_TEXT_TO_VIDEO,
    idempotency_key: key,
  });
  if (existing) {
    if (
      existing.request_fingerprint
        ? existing.request_fingerprint !== fingerprint
        : existing.user_input !== input
    )
      throw new AppError("TASK_IDEMPOTENCY_CONFLICT");
    if (["succeeded", "failed"].includes(existing.status))
      return { task: existing };
    // A pre-worker synchronous call may already have reached a real adapter.
    // Never turn an uncertain legacy outcome into another provider submission.
    if (!existing.request_fingerprint)
      throw new AppError("TASK_CREATE_FAILED", {
        message: "legacy video task requires operator reconciliation",
      });
  }
  const orgUuid = asOrgUuid(params.orgUuid);
  let maxTasks: number | null = null;
  if (!existing?.credits_trans_no) {
    await requireEntitlement(orgUuid, "tasks.text_to_video");
    maxTasks = await limitOf(orgUuid, "tasks.perMonth");
  }
  const cost = calculateTextToVideoCost({ seconds, aspectRatio });
  const outcome = await admitPaidTask({
    task: {
      uuid: newId(),
      org_uuid: params.orgUuid,
      user_uuid: params.userUuid,
      type: TASK_TYPE_TEXT_TO_VIDEO,
      status: "pending_payment",
      credits_used: cost,
      idempotency_key: key,
      request_fingerprint: fingerprint,
      user_input: input,
      created_at: new Date(),
      updated_at: new Date(),
    },
    maxTasks,
    since: startOfUtcMonth(),
    spendPrefix: "task_video",
    transType: CreditsTransType.TaskTextToVideo,
    maxAttempts: TEXT2VIDEO_JOB_ATTEMPTS,
  });
  if (outcome.ok) return { task: outcome.task };
  if (outcome.reason === "quota") {
    await enforceLimit(orgUuid, "tasks.perMonth", {
      current: outcome.current,
      adding: 1,
    });
    throw new AppError("PLAN_LIMIT_EXCEEDED");
  }
  if (outcome.reason === "credits")
    throw new AppError("CREDITS_INSUFFICIENT", {
      details: {
        required: cost,
        available: outcome.available,
        shortfall: Math.max(0, cost - outcome.available),
      },
    });
  throw new AppError("TASK_CREATE_FAILED");
}

async function compensate(
  task: TaskRow,
  code: string,
  context: JobHandlerContext,
) {
  await assertJobActive(context);
  if (!task.credits_trans_no) throw new AppError("TASK_CREATE_FAILED");
  if (task.status !== "refunding") {
    const refunding = await transitionTaskStatus(
      task.uuid,
      task.org_uuid,
      ["queued", "running"],
      "refunding",
      { error_message: code },
      context.lease,
    );
    if (!refunding) throw new AppError("TASK_CREATE_FAILED");
  }
  await assertJobActive(context);
  await refundCreditsForTransaction({
    org_uuid: task.org_uuid,
    user_uuid: task.user_uuid,
    original_trans_no: task.credits_trans_no,
    actor: "system:video_generation_failure",
  });
  await assertJobActive(context);
  if (
    !(await transitionTaskStatus(
      task.uuid,
      task.org_uuid,
      ["refunding"],
      "failed",
      { error_message: code, completed_at: new Date() },
      context.lease,
    ))
  )
    throw new AppError("TASK_CREATE_FAILED");
}

export async function runTextToVideoTask(
  payload: { taskUuid: string; orgUuid: string },
  context: JobHandlerContext,
): Promise<void> {
  await assertJobActive(context);
  const task = await findTaskByUuid(payload.taskUuid, payload.orgUuid);
  if (!task || task.type !== TASK_TYPE_TEXT_TO_VIDEO)
    throw new AppError("TASK_NOT_FOUND");
  if (["succeeded", "failed"].includes(task.status)) return;
  if (task.status === "refunding")
    return compensate(
      task,
      task.error_message ?? "TASK_PROVIDER_FAILED",
      context,
    );
  if (!task.credits_trans_no) throw new AppError("TASK_CREATE_FAILED");
  if (
    !(await transitionTaskStatus(
      task.uuid,
      task.org_uuid,
      ["queued", "running"],
      "running",
      { started_at: task.started_at ?? new Date(), job_uuid: context.jobUuid },
      context.lease,
    ))
  )
    throw new AppError("TASK_CREATE_FAILED");
  try {
    const input = JSON.parse(task.user_input ?? "{}");
    await assertJobActive(context);
    const result = await generateTextToVideo(
      {
        prompt: input.prompt,
        seconds: input.seconds,
        aspectRatio: input.aspect_ratio,
      },
      { idempotencyKey: task.uuid, signal: context.signal },
    );
    await assertJobActive(context);
    if (!result.outputUrl?.trim()) throw new AppError("TASK_PROVIDER_FAILED");
    if (
      !(await transitionTaskStatus(
        task.uuid,
        task.org_uuid,
        ["running"],
        "succeeded",
        {
          output_url: result.outputUrl.trim(),
          output_json: result.raw ? JSON.stringify(result.raw) : null,
          completed_at: new Date(),
          error_message: null,
        },
        context.lease,
      ))
    )
      throw new AppError("TASK_CREATE_FAILED");
  } catch (error) {
    await assertJobActive(context);
    const failure = toAppError(error, "TASK_PROVIDER_FAILED");
    if (
      context.attempt < TEXT2VIDEO_PROVIDER_ATTEMPTS &&
      !["FEATURE_DISABLED", "REQUEST_INVALID"].includes(failure.code)
    ) {
      await transitionTaskStatus(
        task.uuid,
        task.org_uuid,
        ["running"],
        "queued",
        { error_message: failure.code },
        context.lease,
      );
      throw failure;
    }
    await compensate(task, failure.code, context);
  }
}
