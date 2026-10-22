/**
 * Image generation is the starter's reference paid async workflow.
 *
 * These tests pin the orchestration boundaries a type checker cannot: fixed
 * pricing, deterministic replay identities, durable dispatch, provider retry,
 * private output storage, and refund-before-terminal-failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admitPaidTask:
    vi.fn<typeof import("@/models/task-admission").admitPaidTask>(),
  requireEntitlement: vi.fn(),
  limitOf: vi.fn(),
  enforceLimit: vi.fn(),

  findTaskByIdempotencyKey:
    vi.fn<typeof import("@/models/task").findTaskByIdempotencyKey>(),
  findTaskByUuid: vi.fn<typeof import("@/models/task").findTaskByUuid>(),
  transitionTaskStatus:
    vi.fn<typeof import("@/models/task").transitionTaskStatus>(),
  findFileByUuid: vi.fn<typeof import("@/models/file").findFileByUuid>(),
  activateUploadingFile:
    vi.fn<typeof import("@/models/file").activateUploadingFile>(),
  refundCreditsForTransaction:
    vi.fn<typeof import("@/services/credit").refundCreditsForTransaction>(),
  reserveStorageUpload:
    vi.fn<typeof import("@/services/storage/uploads").reserveStorageUpload>(),
  generateImage: vi.fn<typeof import("@/services/ai/image").generateImage>(),
  putObject: vi.fn(),
  headObject: vi.fn(),
}));

vi.mock("@/models/task-admission", () => ({
  admitPaidTask: mocks.admitPaidTask,
  listTaskDispatchRepairs: vi.fn(),
}));
vi.mock("@/services/entitlements", () => ({
  requireEntitlement: mocks.requireEntitlement,
  limitOf: mocks.limitOf,
  enforceLimit: mocks.enforceLimit,
}));

vi.mock("@/lib/demo-flags", () => ({
  isImageGenerationMockEnabled: vi.fn(() => true),
}));

vi.mock("@/models/task", () => ({
  findTaskByIdempotencyKey: mocks.findTaskByIdempotencyKey,
  findTaskByUuid: mocks.findTaskByUuid,
  transitionTaskStatus: mocks.transitionTaskStatus,
}));

vi.mock("@/models/file", () => ({
  findFileByUuid: mocks.findFileByUuid,
  activateUploadingFile: mocks.activateUploadingFile,
}));

vi.mock("@/services/credit", () => ({
  CreditsTransType: { TaskImageGeneration: "task_image_generation" },
  refundCreditsForTransaction: mocks.refundCreditsForTransaction,
}));

vi.mock("@/services/storage/uploads", () => ({
  reserveStorageUpload: mocks.reserveStorageUpload,
}));
vi.mock("@/services/ai/image", () => ({ generateImage: mocks.generateImage }));
vi.mock("@/services/storage", () => ({
  getStorageAdapter: () => ({
    provider: "minio",
    getDefaultBucket: () => "private",
    putObject: mocks.putObject,
    headObject: mocks.headObject,
  }),
}));

import { AppError } from "@/lib/errors/app-error";
import {
  createImageGenerationTask,
  runImageGenerationTask,
} from "@/services/tasks/image-generation";

function task(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: 1,
    uuid: "task-1",
    user_uuid: "user-1",
    org_uuid: "org-1",
    type: "image_generation",
    status: "pending_payment",
    credits_used: 5,
    credits_trans_no: null,
    idempotency_key: "request-1",
    request_fingerprint:
      "bc59f3d42698be826b46046ca5fdf3b50408328a8edd81b55441c4d70daac30e",
    job_uuid: null,
    output_file_uuid: null,
    user_input: JSON.stringify({ prompt: "Draw a small sushi boat" }),
    output_url: null,
    output_json: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  } as import("@/models/task").TaskRow;
}

function file(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: 1,
    uuid: "task-1",
    user_uuid: "user-1",
    org_id: "",
    provider: "minio",
    bucket: "private",
    key: "generated/org-1/task-1.svg",
    region: null,
    endpoint: null,
    version_id: null,
    size: 4,
    content_type: "image/svg+xml",
    etag: "etag-1",
    checksum_sha256: null,
    storage_class: null,
    original_filename: "generated-task-1.svg",
    extension: "svg",
    visibility: "private",
    status: "uploading",
    metadata_json: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    org_uuid: "org-1",
    ...overrides,
  } as Awaited<ReturnType<typeof import("@/models/file").findFileByUuid>> & {};
}

const context = {
  jobUuid: "job-1",
  attempt: 1,
  maxAttempts: 8,
  signal: new AbortController().signal,
  lease: { uuid: "job-1", lockedAt: new Date("2026-01-01") },
};

describe("image-generation task orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireEntitlement.mockResolvedValue({});
    mocks.limitOf.mockResolvedValue(10);
    mocks.admitPaidTask.mockResolvedValue({
      ok: true,
      task: task({
        status: "queued",
        credits_trans_no: "task_image:task-1",
        job_uuid: "job-1",
      }),
      replayed: false,
    });

    mocks.findTaskByIdempotencyKey.mockResolvedValue(undefined);
    mocks.findTaskByUuid.mockResolvedValue(
      task({ status: "queued", credits_trans_no: "task_image:task-1" }),
    );
    mocks.refundCreditsForTransaction.mockResolvedValue(
      "refund_task_image:task-1",
    );
    mocks.transitionTaskStatus.mockImplementation(
      async (_uuid, _org, _expected, status, fields) =>
        task({
          status,
          credits_trans_no: "task_image:task-1",
          ...fields,
        }),
    );
    mocks.findFileByUuid.mockResolvedValue(undefined);
    mocks.generateImage.mockResolvedValue({
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: "image/svg+xml",
      extension: "svg",
      provider: "mock",
      providerRequestId: "mock-task-1",
    });
    mocks.reserveStorageUpload.mockResolvedValue(file() as never);
    mocks.putObject.mockResolvedValue(undefined);
    mocks.headObject.mockResolvedValue({
      size: 4,
      etag: "etag-1",
      contentType: "image/svg+xml",
    });
    mocks.activateUploadingFile.mockResolvedValue(
      file({ status: "active" }) as never,
    );
  });

  it("charges exactly five credits and durably dispatches one task", async () => {
    const result = await createImageGenerationTask({
      orgUuid: "org-1" as never,
      userUuid: "user-1",
      prompt: "Draw a small sushi boat",
      idempotencyKey: "request-1",
    });

    expect(mocks.admitPaidTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          org_uuid: "org-1",
          user_uuid: "user-1",
          credits_used: 5,
        }),
        maxTasks: 10,
        spendPrefix: "task_image",
        transType: "task_image_generation",
        maxAttempts: 8,
      }),
    );
    expect(result.task.job_uuid).toBe("job-1");
  });

  it("rejects reuse of one request key for different input", async () => {
    mocks.findTaskByIdempotencyKey.mockResolvedValue(
      task({ request_fingerprint: "different" }),
    );

    await expect(
      createImageGenerationTask({
        orgUuid: "org-1" as never,
        userUuid: "user-1",
        prompt: "Draw a small sushi boat",
        idempotencyKey: "request-1",
      }),
    ).rejects.toMatchObject({ code: "TASK_IDEMPOTENCY_CONFLICT" });
    expect(mocks.admitPaidTask).not.toHaveBeenCalled();
  });

  it("resumes a charged task without requiring a new quota slot", async () => {
    mocks.findTaskByIdempotencyKey.mockResolvedValue(
      task({ status: "queued", credits_trans_no: "task_image:task-1" }),
    );
    await createImageGenerationTask({
      orgUuid: "org-1" as never,
      userUuid: "user-1",
      prompt: "Draw a small sushi boat",
      idempotencyKey: "request-1",
    });
    expect(mocks.requireEntitlement).not.toHaveBeenCalled();
    expect(mocks.admitPaidTask).toHaveBeenCalledWith(
      expect.objectContaining({ maxTasks: null }),
    );
  });

  it("reports an atomic quota refusal through the entitlement catalog", async () => {
    mocks.admitPaidTask.mockResolvedValue({
      ok: false,
      reason: "quota",
      current: 10,
    });
    await expect(
      createImageGenerationTask({
        orgUuid: "org-1" as never,
        userUuid: "user-1",
        prompt: "Draw a small sushi boat",
        idempotencyKey: "request-1",
      }),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT_EXCEEDED" });
    expect(mocks.enforceLimit).toHaveBeenCalledWith("org-1", "tasks.perMonth", {
      current: 10,
      adding: 1,
    });
  });

  it("reports the balance observed by the refusing transaction", async () => {
    mocks.admitPaidTask.mockResolvedValue({
      ok: false,
      reason: "credits",
      available: 3,
    });
    await expect(
      createImageGenerationTask({
        orgUuid: "org-1" as never,
        userUuid: "user-1",
        prompt: "Draw a small sushi boat",
        idempotencyKey: "request-1",
      }),
    ).rejects.toMatchObject({
      code: "CREDITS_INSUFFICIENT",
      details: { required: 5, available: 3, shortfall: 2 },
    });
  });

  it("does not store, settle or refund a provider response after cancellation", async () => {
    const controller = new AbortController();
    mocks.generateImage.mockImplementationOnce(async () => {
      controller.abort();
      return {
        body: new Uint8Array([1]),
        contentType: "image/svg+xml",
        extension: "svg",
        provider: "mock",
        providerRequestId: "late",
      };
    });
    await expect(
      runImageGenerationTask(
        { taskUuid: "task-1", orgUuid: "org-1" },
        { ...context, signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(mocks.putObject).not.toHaveBeenCalled();
    expect(mocks.refundCreditsForTransaction).not.toHaveBeenCalled();
    expect(mocks.transitionTaskStatus).toHaveBeenCalledTimes(1);
  });

  it("stores the result privately and completes the queued task", async () => {
    await runImageGenerationTask(
      { taskUuid: "task-1", orgUuid: "org-1" },
      context,
    );

    expect(mocks.generateImage).toHaveBeenCalledWith(
      { prompt: "Draw a small sushi boat" },
      expect.objectContaining({ idempotencyKey: "task-1", attempt: 1 }),
    );
    expect(mocks.reserveStorageUpload).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        uuid: "task-1",
        key: "generated/org-1/task-1.svg",
        status: "uploading",
        visibility: "private",
      }),
    );
    expect(mocks.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "private",
        key: "generated/org-1/task-1.svg",
      }),
    );
    expect(mocks.transitionTaskStatus).toHaveBeenLastCalledWith(
      "task-1",
      "org-1",
      ["queued", "running"],
      "succeeded",
      expect.objectContaining({ output_file_uuid: "task-1" }),
      context.lease,
    );
  });

  it("queues a transient provider failure without refunding", async () => {
    mocks.generateImage.mockRejectedValueOnce(
      new AppError("TASK_PROVIDER_FAILED", { message: "provider down" }),
    );

    await expect(
      runImageGenerationTask({ taskUuid: "task-1", orgUuid: "org-1" }, context),
    ).rejects.toMatchObject({ code: "TASK_PROVIDER_FAILED" });

    expect(mocks.transitionTaskStatus).toHaveBeenLastCalledWith(
      "task-1",
      "org-1",
      ["running"],
      "queued",
      { error_message: "TASK_PROVIDER_FAILED" },
      context.lease,
    );
    expect(mocks.refundCreditsForTransaction).not.toHaveBeenCalled();
  });

  it("refunds exactly once before recording a terminal provider failure", async () => {
    mocks.generateImage.mockRejectedValueOnce(
      new AppError("TASK_PROVIDER_FAILED", { message: "provider down" }),
    );

    await runImageGenerationTask(
      { taskUuid: "task-1", orgUuid: "org-1" },
      { ...context, attempt: 5 },
    );

    expect(mocks.refundCreditsForTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.refundCreditsForTransaction).toHaveBeenCalledWith({
      org_uuid: "org-1",
      user_uuid: "user-1",
      original_trans_no: "task_image:task-1",
      actor: "system:image_generation_failure",
    });
    expect(mocks.transitionTaskStatus).toHaveBeenLastCalledWith(
      "task-1",
      "org-1",
      ["refunding"],
      "failed",
      expect.objectContaining({ error_message: "TASK_PROVIDER_FAILED" }),
      context.lease,
    );
  });
});
