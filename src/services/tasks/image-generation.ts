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
import { findJobByDedupeKey } from "@/models/job";
import { asOrgUuid, type OrgUuid } from "@/models/organization";
import {
  findTaskByIdempotencyKey,
  findTaskByUuid,
  insertTaskForIdempotencyKey,
  transitionTaskStatus,
  updateTaskFields,
  type TaskRow,
} from "@/models/task";
import {
  CreditsTransType,
  decreaseCredits,
  refundCreditsForTransaction,
} from "@/services/credit";
import { enqueueJob } from "@/services/jobs";
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
  return createHash("sha256")
    .update(JSON.stringify({ prompt }))
    .digest("hex");
}

function spendTransactionNo(taskUuid: string): string {
  return `task_image:${taskUuid}`;
}

function jobDedupeKey(taskUuid: string): string {
  return `task_image_generation:${taskUuid}`;
}

function assertRequestMatches(task: TaskRow, fingerprint: string): void {
  if (task.request_fingerprint !== fingerprint) {
    throw new AppError("TASK_IDEMPOTENCY_CONFLICT", {
      message: `image-generation idempotency key ${task.idempotency_key} was reused with different input`,
    });
  }
}

async function loadIdempotentTask(params: {
  orgUuid: OrgUuid;
  userUuid: string;
  idempotencyKey: string;
}): Promise<TaskRow> {
  const task = await findTaskByIdempotencyKey({
    org_uuid: params.orgUuid,
    user_uuid: params.userUuid,
    type: TASK_TYPE_IMAGE_GENERATION,
    idempotency_key: params.idempotencyKey,
  });
  if (!task) {
    throw new AppError("TASK_CREATE_FAILED", {
      message: "failed to load image-generation task after insert conflict",
    });
  }
  return task;
}

async function ensureTaskCharged(task: TaskRow): Promise<TaskRow> {
  const expectedTransNo = spendTransactionNo(task.uuid);
  if (task.credits_trans_no && task.credits_trans_no !== expectedTransNo) {
    throw new AppError("TASK_CREATE_FAILED", {
      message: `task ${task.uuid} points at an unexpected credit transaction`,
    });
  }

  if (task.credits_trans_no) return task;
  if (task.status !== "pending_payment" && task.status !== "queued") {
    throw new AppError("TASK_CREATE_FAILED", {
      message: `task ${task.uuid} reached ${task.status} without a credit transaction`,
    });
  }

  const transNo = await decreaseCredits({
    org_uuid: task.org_uuid,
    user_uuid: task.user_uuid,
    trans_type: CreditsTransType.TaskImageGeneration,
    credits: IMAGE_GENERATION_COST_CREDITS,
    trans_no: expectedTransNo,
    actor: `user:${task.user_uuid}`,
    metadata: { task_uuid: task.uuid, task_type: task.type },
  });

  const charged = await transitionTaskStatus(
    task.uuid,
    task.org_uuid,
    ["pending_payment", "queued"],
    "queued",
    { credits_trans_no: transNo, error_message: null },
  );
  if (charged) return charged;

  const current = await findTaskByUuid(task.uuid, task.org_uuid);
  if (current?.credits_trans_no === transNo) return current;
  throw new AppError("TASK_CREATE_FAILED", {
    message: `failed to attach credit transaction to task ${task.uuid}`,
  });
}

async function ensureTaskJob(task: TaskRow): Promise<TaskRow> {
  const dedupeKey = jobDedupeKey(task.uuid);
  await enqueueJob(
    "image_generation",
    {
      taskUuid: task.uuid,
      orgUuid: task.org_uuid,
    },
    {
      dedupeKey,
      maxAttempts: IMAGE_GENERATION_JOB_ATTEMPTS,
      subjectUserUuid: task.user_uuid,
      subjectOrgUuid: task.org_uuid,
      // A replay repairs a job buried by infrastructure failure. Terminal task
      // failures return before this helper and are never regenerated/recharged.
      retryFailed: true,
    },
  );

  const job = await findJobByDedupeKey(dedupeKey);
  if (!job) {
    throw new AppError("TASK_CREATE_FAILED", {
      message: `image-generation job was not persisted for task ${task.uuid}`,
    });
  }

  if (task.job_uuid === job.uuid) return task;
  const updated = await updateTaskFields(task.uuid, task.org_uuid, {
    job_uuid: job.uuid,
  });
  if (!updated) {
    throw new AppError("TASK_CREATE_FAILED", {
      message: `failed to attach job ${job.uuid} to task ${task.uuid}`,
    });
  }
  return updated;
}

/**
 * Persist, charge, and dispatch one replayable five-credit task.
 *
 * Each boundary has a deterministic identity. Repeating the request therefore
 * repairs a crash between boundaries instead of duplicating the next effect.
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
  const now = new Date();
  const inserted = await insertTaskForIdempotencyKey({
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
  });
  const replayed = !inserted;
  let task =
    inserted ??
    (await loadIdempotentTask({
      orgUuid: params.orgUuid,
      userUuid: params.userUuid,
      idempotencyKey,
    }));

  assertRequestMatches(task, fingerprint);
  if (task.status === "succeeded" || task.status === "failed") {
    return { task, replayed: true };
  }

  task = await ensureTaskCharged(task);
  task = await ensureTaskJob(task);
  return { task, replayed };
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

async function storeGeneratedOutput(
  task: TaskRow,
  context: JobHandlerContext,
) {
  let file = await existingGeneratedOutput(task);
  if (file?.status === "active") return file;
  if (file && file.status !== "uploading") {
    throw new AppError("TASK_CREATE_FAILED", {
      message: `task output file ${file.uuid} is ${file.status}`,
    });
  }

  const generated = await generateImage(
    { prompt: JSON.parse(task.user_input ?? "{}").prompt ?? "" },
    {
      idempotencyKey: task.uuid,
      attempt: context.attempt,
      signal: context.signal,
    },
  );
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

  await storage.putObject({
    bucket,
    key,
    body: generated.body,
    contentType: generated.contentType,
    metadata: { task_uuid: task.uuid },
  });
  const stored = await storage.headObject({ bucket, key });
  if (!stored || stored.size !== generated.body.byteLength) {
    throw new AppError("TASK_PROVIDER_FAILED", {
      message: `stored output for task ${task.uuid} did not verify`,
    });
  }

  const active = await activateUploadingFile(file.uuid, task.org_uuid, {
    size: stored.size,
    content_type: stored.contentType ?? generated.contentType,
    etag: stored.etag ?? null,
    checksum_sha256: stored.checksumSHA256 ?? null,
  });
  if (active) return active;

  const current = await existingGeneratedOutput(task);
  if (current?.status === "active") return current;
  throw new AppError("TASK_PROVIDER_FAILED", {
    message: `failed to activate stored output for task ${task.uuid}`,
  });
}

async function completeTaskWithOutput(task: TaskRow, fileUuid: string) {
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
  );
  if (completed) return completed;

  const current = await findTaskByUuid(task.uuid, task.org_uuid);
  if (current?.status === "succeeded") return current;
  if (current?.status === "failed") return current;
  throw new AppError("TASK_CREATE_FAILED", {
    message: `failed to complete image-generation task ${task.uuid}`,
  });
}

async function refundFailedTask(task: TaskRow, errorCode: string): Promise<void> {
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
  let task = await findTaskByUuid(payload.taskUuid, payload.orgUuid);
  if (!task) throw new AppError("TASK_NOT_FOUND");
  if (task.status === "succeeded" || task.status === "failed") return;
  if (task.status === "refunding") {
    await refundFailedTask(task, task.error_message ?? "TASK_PROVIDER_FAILED");
    return;
  }
  if (!task.credits_trans_no) {
    throw new AppError("TASK_CREATE_FAILED", {
      message: `worker received unpaid task ${task.uuid}`,
    });
  }

  const activeOutput = await existingGeneratedOutput(task);
  if (activeOutput?.status === "active") {
    await completeTaskWithOutput(task, activeOutput.uuid);
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
    await completeTaskWithOutput(task, file.uuid);
  } catch (error) {
    const appError = toAppError(error, "TASK_PROVIDER_FAILED");
    if (shouldRetryProvider(appError, context.attempt)) {
      const queued = await transitionTaskStatus(
        task.uuid,
        task.org_uuid,
        ["running"],
        "queued",
        { error_message: appError.code },
      );
      if (!queued) {
        const current = await findTaskByUuid(task.uuid, task.org_uuid);
        if (current?.status === "succeeded" || current?.status === "failed") {
          return;
        }
      }
      throw appError;
    }

    await refundFailedTask(task, appError.code);
  }
}
