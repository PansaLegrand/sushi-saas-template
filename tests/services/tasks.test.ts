import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insertTaskForIdempotencyKey: vi.fn(),
  findTaskByIdempotencyKey: vi.fn(),
  updateTaskStatus: vi.fn(),
  decreaseCredits: vi.fn(),
  refundCreditsForTransaction: vi.fn(),
  generateTextToVideo: vi.fn(),
}));

vi.mock("@/lib/demo-flags", () => ({
  isTextToVideoMockEnabled: vi.fn(() => true),
}));

vi.mock("@/models/task", () => ({
  insertTaskForIdempotencyKey: mocks.insertTaskForIdempotencyKey,
  findTaskByIdempotencyKey: mocks.findTaskByIdempotencyKey,
  updateTaskStatus: mocks.updateTaskStatus,
}));

vi.mock("@/services/credit", () => ({
  CreditsTransType: {
    TaskTextToVideo: "task_text_to_video",
    TaskAdjust: "task_adjust",
  },
  decreaseCredits: mocks.decreaseCredits,
  refundCreditsForTransaction: mocks.refundCreditsForTransaction,
}));

vi.mock("@/services/ai/video", () => ({
  generateTextToVideo: mocks.generateTextToVideo,
}));

import { createTextToVideoTask } from "@/services/tasks";

function task(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-01-01T00:00:00.000Z");

  return {
    id: 1,
    uuid: "task-1",
    user_uuid: "u-test",
    type: "text_to_video",
    status: "running",
    credits_used: 8,
    credits_trans_no: null,
    idempotency_key: "idem-1",
    user_input: JSON.stringify({
      prompt: "hello",
      seconds: 8,
      aspect_ratio: "landscape",
    }),
    output_url: null,
    output_json: null,
    error_message: null,
    started_at: now,
    completed_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("createTextToVideoTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertTaskForIdempotencyKey.mockResolvedValue(task());
    mocks.findTaskByIdempotencyKey.mockResolvedValue(undefined);
    mocks.decreaseCredits.mockResolvedValue("credit-trans-1");
    mocks.refundCreditsForTransaction.mockResolvedValue("refund_credit-trans-1");
    mocks.generateTextToVideo.mockResolvedValue({ outputUrl: "/test.mp4" });
    mocks.updateTaskStatus.mockImplementation(
      async (uuid: string, status: string, fields: Record<string, unknown> = {}) =>
        task({ uuid, status, ...fields, updated_at: new Date("2026-01-01T00:00:01.000Z") })
    );
  });

  it("creates a task, spends credits, and marks the task succeeded", async () => {
    const result = await createTextToVideoTask({
      userUuid: "u-test",
      input: { prompt: "hello", seconds: 8, aspectRatio: "landscape" },
      idempotencyKey: "idem-1",
    });

    expect(mocks.insertTaskForIdempotencyKey).toHaveBeenCalledWith(
      expect.objectContaining({
        user_uuid: "u-test",
        status: "running",
        idempotency_key: "idem-1",
      })
    );
    expect(mocks.decreaseCredits).toHaveBeenCalledWith({
      user_uuid: "u-test",
      trans_type: "task_text_to_video",
      credits: 8,
    });
    expect(mocks.generateTextToVideo).toHaveBeenCalledWith({
      prompt: "hello",
      seconds: 8,
      aspectRatio: "landscape",
    });
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      "task-1",
      "succeeded",
      expect.objectContaining({ output_url: "/test.mp4" })
    );
    expect(result.task.status).toBe("succeeded");
  });

  it("returns the existing task for a repeated idempotency key without spending credits", async () => {
    const existing = task({ uuid: "task-existing", status: "succeeded" });
    mocks.insertTaskForIdempotencyKey.mockResolvedValue(undefined);
    mocks.findTaskByIdempotencyKey.mockResolvedValue(existing);

    const result = await createTextToVideoTask({
      userUuid: "u-test",
      input: { prompt: "hello", seconds: 8, aspectRatio: "landscape" },
      idempotencyKey: "idem-1",
    });

    expect(result.task).toBe(existing);
    expect(mocks.findTaskByIdempotencyKey).toHaveBeenCalledWith({
      user_uuid: "u-test",
      type: "text_to_video",
      idempotency_key: "idem-1",
    });
    expect(mocks.decreaseCredits).not.toHaveBeenCalled();
    expect(mocks.generateTextToVideo).not.toHaveBeenCalled();
  });

  it("refunds credits and marks the task failed when the provider fails", async () => {
    const providerError = new Error("provider down");
    mocks.generateTextToVideo.mockRejectedValue(providerError);

    await expect(
      createTextToVideoTask({
        userUuid: "u-test",
        input: { prompt: "hello", seconds: 8, aspectRatio: "landscape" },
        idempotencyKey: "idem-1",
      })
    ).rejects.toThrow("provider down");

    expect(mocks.refundCreditsForTransaction).toHaveBeenCalledWith({
      user_uuid: "u-test",
      original_trans_no: "credit-trans-1",
    });
    expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
      "task-1",
      "failed",
      expect.objectContaining({
        credits_trans_no: "credit-trans-1",
        error_message: "provider down",
      })
    );
  });
});
