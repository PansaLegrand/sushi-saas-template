/**
 * Integration tests for the text-to-video task API.
 *
 * The route is a demo/mock provider surface. It must be disabled by default so
 * production clones do not expose credit-consuming playground behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";

vi.mock("@/services/user", () => ({
  getUserUuid: vi.fn().mockResolvedValue("u-test"),
}));

vi.mock("@/services/tasks", () => ({
  createTextToVideoTask: vi.fn().mockResolvedValue({
    task: {
      uuid: "task-test",
      user_uuid: "u-test",
      type: "text_to_video",
      status: "succeeded",
      credits_used: 8,
      credits_trans_no: "credit-trans-test",
      user_input: JSON.stringify({ prompt: "hello", seconds: 8 }),
      output_url: "/test.mp4",
      output_json: null,
      error_message: null,
      started_at: new Date("2026-01-01T00:00:00.000Z"),
      completed_at: new Date("2026-01-01T00:00:01.000Z"),
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:01.000Z"),
    },
  }),
}));

import { POST as createTextToVideo } from "@/app/api/tasks/text-to-video/route";

describe("POST /api/tasks/text-to-video", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ENABLE_DEMO_FEATURES;
    delete process.env.ENABLE_TEXT2VIDEO_MOCK;
    resetEnvCacheForTests();
  });

  it("rejects requests when the demo provider is disabled", async () => {
    const req = new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    const res = await createTextToVideo(req);
    const tasks = await import("@/services/tasks");

    expect(res.status).toBe(404);
    expect(tasks.createTextToVideoTask).not.toHaveBeenCalled();
  });

  it("creates a demo task when the mock provider is explicitly enabled", async () => {
    process.env.ENABLE_DEMO_FEATURES = "true";
    process.env.ENABLE_TEXT2VIDEO_MOCK = "true";
    resetEnvCacheForTests();

    const req = new Request("http://test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "hello", seconds: 8 }),
    });

    const res = await createTextToVideo(req);
    const payload = await res.json();
    const tasks = await import("@/services/tasks");

    expect(res.status).toBe(200);
    expect(payload.code).toBe(0);
    expect(payload.data.task.uuid).toBe("task-test");
    expect(tasks.createTextToVideoTask).toHaveBeenCalledWith({
      userUuid: "u-test",
      input: { prompt: "hello", seconds: 8, aspectRatio: "landscape" },
    });
  });
});
