/** Video admission must share atomic paid-task semantics and worker compensation. */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  admit: vi.fn(),
  find: vi.fn(),
  read: vi.fn(),
  transition: vi.fn(),
  refund: vi.fn(),
  generate: vi.fn(),
  require: vi.fn(),
  limit: vi.fn(),
  enforce: vi.fn(),
}));
vi.mock("@/lib/demo-flags", () => ({ isTextToVideoMockEnabled: () => true }));
vi.mock("@/models/task-admission", () => ({ admitPaidTask: mocks.admit }));
vi.mock("@/models/task", () => ({
  findTaskByIdempotencyKey: mocks.find,
  findTaskByUuid: mocks.read,
  transitionTaskStatus: mocks.transition,
}));
vi.mock("@/services/credit", () => ({
  CreditsTransType: { TaskTextToVideo: "task_text_to_video" },
  refundCreditsForTransaction: mocks.refund,
}));
vi.mock("@/services/ai/video", () => ({ generateTextToVideo: mocks.generate }));
vi.mock("@/services/entitlements", () => ({
  requireEntitlement: mocks.require,
  limitOf: mocks.limit,
  enforceLimit: mocks.enforce,
}));
import { AppError } from "@/lib/errors";
import { createTextToVideoTask, runTextToVideoTask } from "@/services/tasks";

const input = {
  orgUuid: "org-1",
  userUuid: "user-1",
  input: { prompt: "hello", seconds: 8, aspectRatio: "landscape" },
  idempotencyKey: "request-1",
};
const context = {
  jobUuid: "job-1",
  attempt: 1,
  maxAttempts: 8,
  signal: new AbortController().signal,
};
function task(extra: Record<string, unknown> = {}) {
  return {
    uuid: "task-1",
    org_uuid: "org-1",
    user_uuid: "user-1",
    type: "text_to_video",
    status: "queued",
    credits_used: 8,
    credits_trans_no: "task_video:task-1",
    request_fingerprint: null,
    user_input: JSON.stringify({
      prompt: "hello",
      seconds: 8,
      aspect_ratio: "landscape",
    }),
    ...extra,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.limit.mockResolvedValue(50);
  mocks.admit.mockResolvedValue({ ok: true, task: task(), replayed: false });
  mocks.read.mockResolvedValue(task());
  mocks.generate.mockResolvedValue({ outputUrl: "/test.mp4" });
  mocks.transition.mockImplementation(
    async (_id, _org, _expected, status, fields) => task({ status, ...fields }),
  );
});
describe("durable video tasks", () => {
  it("reserves eight credits and durable dispatch without invoking a provider inline", async () => {
    expect(await createTextToVideoTask(input)).toMatchObject({
      task: { status: "queued" },
    });
    expect(mocks.require).toHaveBeenCalledWith("org-1", "tasks.text_to_video");
    expect(mocks.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTasks: 50,
        spendPrefix: "task_video",
        task: expect.objectContaining({
          credits_used: 8,
          idempotency_key: "request-1",
        }),
      }),
    );
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("refuses missing replay identity before admission", async () => {
    await expect(
      createTextToVideoTask({ ...input, idempotencyKey: undefined }),
    ).rejects.toMatchObject({ code: "REQUEST_MISSING_FIELD" });
    expect(mocks.admit).not.toHaveBeenCalled();
  });
  it("rejects different input with the same identity", async () => {
    mocks.find.mockResolvedValue(task({ request_fingerprint: "different" }));
    await expect(createTextToVideoTask(input)).rejects.toMatchObject({
      code: "TASK_IDEMPOTENCY_CONFLICT",
    });
    expect(mocks.admit).not.toHaveBeenCalled();
  });
  it("returns a terminal legacy replay without requiring another entitlement", async () => {
    mocks.find.mockResolvedValue(task({ status: "succeeded" }));
    expect(await createTextToVideoTask(input)).toMatchObject({
      task: { status: "succeeded" },
    });
    expect(mocks.require).not.toHaveBeenCalled();
    expect(mocks.admit).not.toHaveBeenCalled();
  });
  it("never resubmits an uncertain synchronous legacy task", async () => {
    mocks.find.mockResolvedValue(task({ status: "running" }));
    await expect(createTextToVideoTask(input)).rejects.toMatchObject({
      code: "TASK_CREATE_FAILED",
    });
    expect(mocks.admit).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("enforces feature access before any financial effect", async () => {
    mocks.require.mockRejectedValue(new AppError("PLAN_UPGRADE_REQUIRED"));
    await expect(createTextToVideoTask(input)).rejects.toMatchObject({
      code: "PLAN_UPGRADE_REQUIRED",
    });
    expect(mocks.admit).not.toHaveBeenCalled();
  });
  it("reports an atomic quota refusal", async () => {
    mocks.admit.mockResolvedValue({ ok: false, reason: "quota", current: 50 });
    await expect(createTextToVideoTask(input)).rejects.toMatchObject({
      code: "PLAN_LIMIT_EXCEEDED",
    });
    expect(mocks.enforce).toHaveBeenCalledWith("org-1", "tasks.perMonth", {
      current: 50,
      adding: 1,
    });
  });
  it("reports the refusing transaction's actual balance", async () => {
    mocks.admit.mockResolvedValue({
      ok: false,
      reason: "credits",
      available: 3,
    });
    await expect(createTextToVideoTask(input)).rejects.toMatchObject({
      code: "CREDITS_INSUFFICIENT",
      details: { required: 8, available: 3, shortfall: 5 },
    });
  });
  it("executes with a stable provider identity and records the output", async () => {
    await runTextToVideoTask({ taskUuid: "task-1", orgUuid: "org-1" }, context);
    expect(mocks.generate).toHaveBeenCalledWith(input.input, {
      idempotencyKey: "task-1",
      signal: context.signal,
    });
    expect(mocks.transition).toHaveBeenLastCalledWith(
      "task-1",
      "org-1",
      ["running"],
      "succeeded",
      expect.objectContaining({ output_url: "/test.mp4" }),
      undefined,
    );
  });
  it("retries a transient provider failure without refunding", async () => {
    mocks.generate.mockRejectedValue(new AppError("TASK_PROVIDER_FAILED"));
    await expect(
      runTextToVideoTask({ taskUuid: "task-1", orgUuid: "org-1" }, context),
    ).rejects.toMatchObject({ code: "TASK_PROVIDER_FAILED" });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.transition).toHaveBeenLastCalledWith(
      "task-1",
      "org-1",
      ["running"],
      "queued",
      expect.any(Object),
      undefined,
    );
  });
  it("never records empty provider output as success and compensates after retry exhaustion", async () => {
    mocks.generate.mockResolvedValue({ outputUrl: "   " });
    await runTextToVideoTask({ taskUuid: "task-1", orgUuid: "org-1" }, { ...context, attempt: 5 });
    expect(mocks.transition.mock.calls.some(call => call[3] === "succeeded")).toBe(false);
    expect(mocks.refund).toHaveBeenCalledWith(expect.objectContaining({ original_trans_no: "task_video:task-1" }));
    mocks.read.mockResolvedValue(task({ status: "failed" }));
    await runTextToVideoTask({ taskUuid: "task-1", orgUuid: "org-1" }, { ...context, attempt: 5 });
    expect(mocks.refund).toHaveBeenCalledTimes(1);
  });
  it("compensates terminal failure before recording failed", async () => {
    mocks.generate.mockRejectedValue(new AppError("TASK_PROVIDER_FAILED"));
    await runTextToVideoTask(
      { taskUuid: "task-1", orgUuid: "org-1" },
      { ...context, attempt: 5 },
    );
    expect(mocks.refund).toHaveBeenCalledWith(
      expect.objectContaining({ original_trans_no: "task_video:task-1" }),
    );
    expect(mocks.refund.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.transition.mock.invocationCallOrder.at(-1)!,
    );
  });
  it("resumes compensation without generating again", async () => {
    mocks.read.mockResolvedValue(task({ status: "refunding" }));
    await runTextToVideoTask({ taskUuid: "task-1", orgUuid: "org-1" }, context);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.refund).toHaveBeenCalledOnce();
  });
});
