/** The HTTP boundary authenticates and validates before delegating atomic admission. */
import { beforeEach, expect, it, vi } from "vitest";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetRateLimitForTests } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import { postJson } from "../helpers/request";
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  create: vi.fn(),
  present: vi.fn(),
}));
vi.mock("@/services/authz", () => ({ getOrgContext: mocks.context }));
vi.mock("@/services/tasks", () => ({ createTextToVideoTask: mocks.create }));
vi.mock("@/services/tasks/presentation", () => ({
  toTaskRecord: mocks.present,
}));
import { POST } from "@/app/api/tasks/text-to-video/route";
const body = { prompt: "hello", seconds: 8, idempotencyKey: "request-1" };
beforeEach(() => {
  vi.resetAllMocks();
  process.env.ENABLE_DEMO_FEATURES = "true";
  process.env.ENABLE_TEXT2VIDEO_MOCK = "true";
  resetEnvCacheForTests();
  resetRateLimitForTests();
  mocks.context.mockResolvedValue({ orgUuid: "org-1", userUuid: "user-1" });
  mocks.create.mockResolvedValue({
    task: { uuid: "task-1", status: "queued" },
  });
  mocks.present.mockResolvedValue({ uuid: "task-1", status: "queued" });
});
it("refuses unauthenticated calls before any task access", async () => {
  mocks.context.mockResolvedValue(null);
  expect((await POST(postJson("/api/tasks/text-to-video", body))).status).toBe(
    401,
  );
  expect(mocks.create).not.toHaveBeenCalled();
});
it("hides the demo while disabled", async () => {
  process.env.ENABLE_TEXT2VIDEO_MOCK = "false";
  resetEnvCacheForTests();
  expect((await POST(postJson("/api/tasks/text-to-video", body))).status).toBe(
    404,
  );
  expect(mocks.context).not.toHaveBeenCalled();
});
it("returns 202 with an explicit replay key", async () => {
  const response = await POST(postJson("/api/tasks/text-to-video", body));
  expect(response.status).toBe(202);
  expect((await response.json()).data.task.uuid).toBe("task-1");
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: "request-1" }),
  );
});
it("accepts a standard idempotency header", async () => {
  expect(
    (
      await POST(
        postJson(
          "/api/tasks/text-to-video",
          { prompt: "hello" },
          { headers: { "Idempotency-Key": "header-1" } },
        ),
      )
    ).status,
  ).toBe(202);
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: "header-1" }),
  );
});
it.each([
  { prompt: "hello" },
  { ...body, seconds: 61 },
  { ...body, seconds: 1.5 },
])("refuses invalid admission input without spending", async (invalid) => {
  expect(
    (await POST(postJson("/api/tasks/text-to-video", invalid))).status,
  ).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("returns a catalogued service refusal", async () => {
  mocks.create.mockRejectedValue(new AppError("PLAN_LIMIT_EXCEEDED"));
  const response = await POST(postJson("/api/tasks/text-to-video", body));
  expect(response.status).toBe(403);
  expect((await response.json()).error_code).toBe("PLAN_LIMIT_EXCEEDED");
});
