import { createHash } from "node:crypto";

import {
  IMAGE_GENERATION_COST_CREDITS,
  IMAGE_GENERATION_JOB_ATTEMPTS,
  IMAGE_GENERATION_PROVIDER_ATTEMPTS,
} from "@/config/tasks";
import { generateImage } from "@/services/ai/image";
import { isImageGenerationMockEnabled } from "@/lib/demo-flags";
import { AppError, isAppError, toAppError } from "@/lib/errors/app-error";
import { newId } from "@/lib/ids";
import {
  activateUploadingFile,
  findFileByUuid,
  type FileInsert,
} from "@/models/file";
import {
  admitPaidTask,
  listTaskDispatchRepairs,
} from "@/models/task-admission";
import { logger } from "@/lib/logger/server";
import { startOfUtcMonth } from "@/lib/time";
import {
  enforceLimit,
  limitOf,
  requireEntitlement,
} from "@/services/entitlements";
import { asOrgUuid, type OrgUuid } from "@/models/organization";
import {
  findTaskByIdempotencyKey,
  findTaskByUuid,
  transitionTaskStatus,
  type TaskRow,
} from "@/models/task";
import {
  CreditsTransType,
  refundCreditsForTransaction,
} from "@/services/credit";
import { assertJobActive } from "@/services/jobs/execution";
import type { JobHandlerContext } from "@/services/jobs/types";
import { getStorageAdapter } from "@/services/storage";
import { reserveStorageUpload } from "@/services/storage/uploads";

export const TASK_TYPE_IMAGE_GENERATION = "image_generation" as const;
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const MAX_PROMPT_LENGTH = 1_000;

export type CreateImageGenerationTaskParams = {
  orgUuid: OrgUuid;
  userUuid: string;
  prompt: string;
  idempotencyKey: string;
};

function fingerprintRequest(prompt: string): string {
  return createHash("sha256").update(JSON.stringify({ prompt })).digest("hex");
}

function assertRequestMatches(task: TaskRow, fingerprint: string): void {
  if (task.request_fingerprint !== fingerprint) {
    throw new AppError("TASK_IDEMPOTENCY_CONFLICT", {
      message: `image-generation idempotency key ${task.idempotency_key} was reused with different input`,
    });
  }
}

/**
 * Persist, charge, and dispatch one replayable five-credit task.
 *
 * Quota, debit, task and dispatch are committed atomically. Replays resolve
 * their existing identity before a new-operation entitlement/quota decision.
 */
export async function createImageGenerationTask(
  params: CreateImageGenerationTaskParams,
): Promise<{ task: TaskRow; replayed: boolean }> {
  if (!isImageGenerationMockEnabled()) {
    throw new AppError("FEATURE_DISABLED", {
      message: "image-generation mock provider is disabled",
    });
  }

  const prompt = params.prompt.trim();
  const idempotencyKey = params.idempotencyKey.trim();
  if (!prompt) throw new AppError("TASK_PROMPT_REQUIRED");
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new AppError("REQUEST_INVALID", {
      message: `image-generation prompt too long: ${prompt.length}`,
      details: { field: "prompt", max: MAX_PROMPT_LENGTH },
    });
  }
  if (!idempotencyKey) {
    throw new AppError("REQUEST_MISSING_FIELD", {
      message: "image-generation idempotency key is required",
      details: { field: "idempotencyKey" },
    });
  }
  if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new AppError("REQUEST_INVALID", {
      message: `idempotency key too long: ${idempotencyKey.length}`,
      details: {
        field: "idempotencyKey",
        max: MAX_IDEMPOTENCY_KEY_LENGTH,
      },
    });
  }

  const fingerprint = fingerprintRequest(prompt);
  const existing = await findTaskByIdempotencyKey({
    org_uuid: params.orgUuid,
    user_uuid: params.userUuid,
    type: TASK_TYPE_IMAGE_GENERATION,
    idempotency_key: idempotencyKey,
  });
  if (existing) {
    assertRequestMatches(existing, fingerprint);
    if (existing.status === "succeeded" || existing.status === "failed") {
      return { task: existing, replayed: true };
    }
  }
  let maxTasks: number | null = null;
  if (!existing?.credits_trans_no) {
    await requireEntitlement(params.orgUuid, "tasks.image_generation");
    maxTasks = await limitOf(params.orgUuid, "tasks.perMonth");
  }
  const now = new Date();
  const outcome = await admitPaidTask({
    task: {
      uuid: newId(),
      org_uuid: params.orgUuid,
      user_uuid: params.userUuid,
      type: TASK_TYPE_IMAGE_GENERATION,
      status: "pending_payment",
      credits_used: IMAGE_GENERATION_COST_CREDITS,
      idempotency_key: idempotencyKey,
      request_fingerprint: fingerprint,
      user_input: JSON.stringify({ prompt }),
      created_at: now,
      updated_at: now,
    },
    maxTasks,
    since: startOfUtcMonth(),
    spendPrefix: "task_image",
    transType: CreditsTransType.TaskImageGeneration,
    maxAttempts: IMAGE_GENERATION_JOB_ATTEMPTS,
  });
  if (outcome.ok) return { task: outcome.task, replayed: outcome.replayed };
  if (outcome.reason === "quota") {
    await enforceLimit(params.orgUuid, "tasks.perMonth", {
      current: outcome.current,
      adding: 1,
    });
    throw new AppError("PLAN_LIMIT_EXCEEDED");
  }
  if (outcome.reason === "credits") {
    throw new AppError("CREDITS_INSUFFICIENT", {
      details: {
        required: IMAGE_GENERATION_COST_CREDITS,
        available: outcome.available,
        shortfall: Math.max(
          0,
          IMAGE_GENERATION_COST_CREDITS - outcome.available,
        ),
      },
    });
  }
  throw new AppError("TASK_CREATE_FAILED");
}

/** Repair historical charged intents without creating a new credit spend. */
export async function reconcileImageTaskDispatch(
  now = new Date(),
): Promise<number> {
  const candidates = await listTaskDispatchRepairs(
    new Date(now.getTime() - 5 * 60_000),
  );
  let repaired = 0;
  for (const task of candidates) {
    if (!task.idempotency_key || !task.request_fingerprint) continue;
    try {
      const outcome = await admitPaidTask({
        task: {
          ...task,
          idempotency_key: task.idempotency_key,
          request_fingerprint: task.request_fingerprint,
        },
        maxTasks: null,
        since: startOfUtcMonth(),
        spendPrefix: "task_image",
        transType: CreditsTransType.TaskImageGeneration,
        maxAttempts: IMAGE_GENERATION_JOB_ATTEMPTS,
        repairOnly: true,
      });
      if (outcome.ok) repaired += 1;
    } catch (err) {
      logger.error(
        { err, task_uuid: task.uuid },
        "task dispatch repair failed",
      );
    }
  }
  return repaired;
}

function generatedObjectKey(task: TaskRow): string {
  const org = task.org_uuid.replace(/[^a-zA-Z0-9_-]/g, "-");
  const uuid = task.uuid.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `generated/${org}/${uuid}.svg`;
}

async function existingGeneratedOutput(task: TaskRow) {
  const existing = await findFileByUuid(task.uuid, task.org_uuid);
  if (!existing) return undefined;

  if (existing.key !== generatedObjectKey(task)) {
    throw new AppError("TASK_CREATE_FAILED", {
      message: `task output file identity ${task.uuid} belongs to another object`,
    });
  }
  return existing;
}

async function storeGeneratedOutput(task: TaskRow, context: JobHandlerContext) {
  await assertJobActive(context);
  let file = await existingGeneratedOutput(task);
  if (file?.status === "active") return file;
  if (file && file.status !== "uploading") {
    throw new AppError("TASK_CREATE_FAILED", {
      message: `task output file ${file.uuid} is ${file.status}`,
    });
  }

  await assertJobActive(context);
  const generated = await generateImage(
    { prompt: JSON.parse(task.user_input ?? "{}").prompt ?? "" },
    {
      idempotencyKey: task.uuid,
      attempt: context.attempt,
      signal: context.signal,
    },
  );
  await assertJobActive(context);
  const storage = getStorageAdapter();
  const bucket = storage.getDefaultBucket();
  const key = generatedObjectKey(task);

  if (!file) {
    const data: FileInsert & { size: number } = {
      uuid: task.uuid,
      org_uuid: task.org_uuid,
      user_uuid: task.user_uuid,
      provider: storage.provider,
      bucket,
      key,
      size: generated.body.byteLength,
      content_type: generated.contentType,
      original_filename: `generated-${task.uuid}.${generated.extension}`,
      extension: generated.extension,
      visibility: "private",
      status: "uploading",
      metadata_json: JSON.stringify({
        task_uuid: task.uuid,
        task_type: task.type,
        provider: generated.provider,
        provider_request_id: generated.providerRequestId,
      }),
    };
    file = await reserveStorageUpload(asOrgUuid(task.org_uuid), data);
  }

  await assertJobActive(context);
  await storage.putObject({
    signal: context.signal,
    bucket,
    key,
    body: generated.body,
    contentType: generated.contentType,
    metadata: { task_uuid: task.uuid },
  });
  await assertJobActive(context);
  const stored = await storage.headObject({
    bucket,
    key,
    signal: context.signal,
  });
  await assertJobActive(context);
  if (!stored || stored.size !== generated.body.byteLength) {
    throw new AppError("TASK_PROVIDER_FAILED", {
      message: `stored output for task ${task.uuid} did not verify`,
    });
  }

  const active = await activateUploadingFile(
    file.uuid,
    task.org_uuid,
    {
      size: stored.size,
      content_type: stored.contentType ?? generated.contentType,
      etag: stored.etag ?? null,
      checksum_sha256: stored.checksumSHA256 ?? null,
    },
    context.lease,
  );
  if (active) return active;

  const current = await existingGeneratedOutput(task);
  if (current?.status === "active") return current;
  throw new AppError("TASK_PROVIDER_FAILED", {
    message: `failed to activate stored output for task ${task.uuid}`,
  });
}

async function completeTaskWithOutput(
  task: TaskRow,
  fileUuid: string,
  context: JobHandlerContext,
) {
  await assertJobActive(context);
  const completed = await transitionTaskStatus(
    task.uuid,
    task.org_uuid,
    ["queued", "running"],
    "succeeded",
    {
      output_file_uuid: fileUuid,
      output_json: JSON.stringify({ file_uuid: fileUuid }),
      error_message: null,
      completed_at: new Date(),
    },
    context.lease,
  );
  if (completed) return completed;

  const current = await findTaskByUuid(task.uuid, task.org_uuid);
  if (current?.status === "succeeded") return current;
  if (current?.status === "failed") return current;
  throw new AppError("TASK_CREATE_FAILED", {
    message: `failed to complete image-generation task ${task.uuid}`,
  });
}

async function refundFailedTask(
  task: TaskRow,
  errorCode: string,
  context: JobHandlerContext,
): Promise<void> {
  await assertJobActive(context);
  if (!task.credits_trans_no) {
    throw new AppError("TASK_CREATE_FAILED", {
      message: `cannot refund task ${task.uuid} without a credit transaction`,
    });
  }
  const creditTransNo = task.credits_trans_no;

  const refunding =
    task.status === "refunding"
      ? task
      : await transitionTaskStatus(
          task.uuid,
          task.org_uuid,
          ["queued", "running"],
          "refunding",
          { error_message: errorCode },
          context.lease,
        );
  if (!refunding) {
    const current = await findTaskByUuid(task.uuid, task.org_uuid);
    if (current?.status === "succeeded" || current?.status === "failed") return;
    if (current?.status === "refunding") task = current;
    else {
      throw new AppError("TASK_CREATE_FAILED", {
        message: `failed to move task ${task.uuid} into refunding`,
      });
    }
  } else {
    task = refunding;
  }

  await assertJobActive(context);
  await refundCreditsForTransaction({
    org_uuid: task.org_uuid,
    user_uuid: task.user_uuid,
    original_trans_no: creditTransNo,
    actor: "system:image_generation_failure",
  });
  const failed = await transitionTaskStatus(
    task.uuid,
    task.org_uuid,
    ["refunding"],
    "failed",
    { error_message: errorCode, completed_at: new Date() },
    context.lease,
  );
  if (failed) return;

  const current = await findTaskByUuid(task.uuid, task.org_uuid);
  if (current?.status !== "failed" && current?.status !== "succeeded") {
    throw new AppError("TASK_CREATE_FAILED", {
      message: `failed to finalize compensated task ${task.uuid}`,
    });
  }
}

function shouldRetryProvider(error: unknown, attempt: number): boolean {
  if (attempt >= IMAGE_GENERATION_PROVIDER_ATTEMPTS) return false;
  if (!isAppError(error)) return true;
  return ![
    "FEATURE_DISABLED",
    "PLAN_LIMIT_EXCEEDED",
    "REQUEST_INVALID",
  ].includes(error.code);
}

/** Execute one durable worker attempt, including terminal compensation. */
export async function runImageGenerationTask(
  payload: { taskUuid: string; orgUuid: string },
  context: JobHandlerContext,
): Promise<void> {
  await assertJobActive(context);
  let task = await findTaskByUuid(payload.taskUuid, payload.orgUuid);
  if (!task) throw new AppError("TASK_NOT_FOUND");
  if (task.status === "succeeded" || task.status === "failed") return;
  if (task.status === "refunding") {
    await refundFailedTask(
      task,
      task.error_message ?? "TASK_PROVIDER_FAILED",
      context,
    );
    return;
  }
  if (!task.credits_trans_no) {
    throw new AppError("TASK_CREATE_FAILED", {
      message: `worker received unpaid task ${task.uuid}`,
    });
  }

  const activeOutput = await existingGeneratedOutput(task);
  if (activeOutput?.status === "active") {
    await completeTaskWithOutput(task, activeOutput.uuid, context);
    return;
  }

  const running = await transitionTaskStatus(
    task.uuid,
    task.org_uuid,
    ["queued", "running"],
    "running",
    {
      job_uuid: context.jobUuid,
      started_at: task.started_at ?? new Date(),
      error_message: null,
    },
    context.lease,
  );
  if (!running) {
    const current = await findTaskByUuid(task.uuid, task.org_uuid);
    if (current?.status === "succeeded" || current?.status === "failed") return;
    throw new AppError("TASK_CREATE_FAILED", {
      message: `failed to claim task ${task.uuid} for worker ${context.jobUuid}`,
    });
  }
  task = running;

  try {
    const file = await storeGeneratedOutput(task, context);
    await completeTaskWithOutput(task, file.uuid, context);
  } catch (error) {
    // An aborted/stale attempt must not refund or regress the newer attempt.
    await assertJobActive(context);
    const appError = toAppError(error, "TASK_PROVIDER_FAILED");
    if (shouldRetryProvider(appError, context.attempt)) {
      const queued = await transitionTaskStatus(
        task.uuid,
        task.org_uuid,
        ["running"],
        "queued",
        { error_message: appError.code },
        context.lease,
      );
      if (!queued) {
        const current = await findTaskByUuid(task.uuid, task.org_uuid);
        if (current?.status === "succeeded" || current?.status === "failed") {
          return;
        }
      }
      throw appError;
    }

    await refundFailedTask(task, appError.code, context);
  }
}
