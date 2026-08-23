/**
 * Route contract for the paid asynchronous image task.
 *
 * The route must stay hidden unless explicitly enabled, authenticate before
 * touching tenant data, enforce entitlements/quota before spending, require a
 * replay key, and return 202 while the durable worker owns the task.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCacheForTests } from "@/lib/env";
import { resetRateLimitForTests } from "@/lib/rate-limit";
import { postJson } from "../helpers/request";

const mocks = vi.hoisted(() => ({
  getOrgContext: vi.fn<typeof import("@/services/authz").getOrgContext>(),
  requireEntitlement: vi.fn<
    typeof import("@/services/entitlements").requireEntitlement
  >(),
  enforceLimit: vi.fn<
    typeof import("@/services/entitlements").enforceLimit
  >(),
  countTasksByOrgSince: vi.fn<
    typeof import("@/models/task").countTasksByOrgSince
  >(),
  createImageGenerationTask: vi.fn<
    typeof import("@/services/tasks/image-generation").createImageGenerationTask
  >(),
  toTaskRecord: vi.fn<
    typeof import("@/services/tasks/presentation").toTaskRecord
  >(),
}));

vi.mock("@/services/authz", () => ({ getOrgContext: mocks.getOrgContext }));
vi.mock("@/services/entitlements", () => ({
  requireEntitlement: mocks.requireEntitlement,
  enforceLimit: mocks.enforceLimit,
}));
vi.mock("@/models/task", () => ({
  countTasksByOrgSince: mocks.countTasksByOrgSince,
}));
vi.mock("@/services/tasks/image-generation", () => ({
  createImageGenerationTask: mocks.createImageGenerationTask,
}));
vi.mock("@/services/tasks/presentation", () => ({
  toTaskRecord: mocks.toTaskRecord,
}));

import { POST } from "@/app/api/tasks/image-generation/route";

const taskRow = { uuid: "task-1" } as never;
const taskRecord = {
  uuid: "task-1",
  userUuid: "user-1",
  type: "image_generation",
  status: "queued" as const,
  creditsUsed: 5,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
};

function enableImageGeneration() {
  process.env.ENABLE_DEMO_FEATURES = "true";
  process.env.ENABLE_IMAGE_GENERATION_MOCK = "true";
  resetEnvCacheForTests();
}

describe("POST /api/tasks/image-generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ENABLE_DEMO_FEATURES;
    delete process.env.ENABLE_IMAGE_GENERATION_MOCK;
    resetEnvCacheForTests();
    resetRateLimitForTests();

    mocks.getOrgContext.mockResolvedValue({
      userId: "id-1",
      userUuid: "user-1",
      orgId: "org-id-1",
      orgUuid: "org-1" as never,
      orgSlug: "demo",
      orgName: "Demo",
      orgIsPersonal: true,
      role: "owner",
    });
    mocks.requireEntitlement.mockResolvedValue({} as never);
    mocks.enforceLimit.mockResolvedValue(undefined);
    mocks.countTasksByOrgSince.mockResolvedValue(0);
    mocks.createImageGenerationTask.mockResolvedValue({
      task: taskRow,
      replayed: false,
    });
    mocks.toTaskRecord.mockResolvedValue(taskRecord);
  });

  it("stays hidden while the local mock is disabled", async () => {
    const response = await POST(
      postJson("/api/tasks/image-generation", {
        prompt: "sushi boat",
        idempotencyKey: "request-1",
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.getOrgContext).not.toHaveBeenCalled();
    expect(mocks.createImageGenerationTask).not.toHaveBeenCalled();
  });

  it("authenticates before reading quota or creating a task", async () => {
    enableImageGeneration();
    mocks.getOrgContext.mockResolvedValue(null);

    const response = await POST(
      postJson("/api/tasks/image-generation", {
        prompt: "sushi boat",
        idempotencyKey: "request-1",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.requireEntitlement).not.toHaveBeenCalled();
    expect(mocks.countTasksByOrgSince).not.toHaveBeenCalled();
    expect(mocks.createImageGenerationTask).not.toHaveBeenCalled();
  });

  it("enforces plan gates then returns a durable queued task", async () => {
    enableImageGeneration();

    const response = await POST(
      postJson("/api/tasks/image-generation", {
        prompt: "  sushi boat  ",
        idempotencyKey: "request-1",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload.data).toEqual({ task: taskRecord, replayed: false });
    expect(mocks.requireEntitlement).toHaveBeenCalledWith(
      "org-1",
      "tasks.image_generation",
    );
    expect(mocks.enforceLimit).toHaveBeenCalledWith(
      "org-1",
      "tasks.perMonth",
      { current: 0, adding: 1 },
    );
    expect(mocks.createImageGenerationTask).toHaveBeenCalledWith({
      orgUuid: "org-1",
      userUuid: "user-1",
      prompt: "sushi boat",
      idempotencyKey: "request-1",
    });
  });

  it("accepts the standard idempotency header", async () => {
    enableImageGeneration();

    const response = await POST(
      postJson(
        "/api/tasks/image-generation",
        { prompt: "sushi boat" },
        { headers: { "idempotency-key": "request-from-header" } },
      ),
    );

    expect(response.status).toBe(202);
    expect(mocks.createImageGenerationTask).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "request-from-header" }),
    );
  });

  it("refuses a mutation without a replay key", async () => {
    enableImageGeneration();

    const response = await POST(
      postJson("/api/tasks/image-generation", { prompt: "sushi boat" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error_code).toBe("REQUEST_MISSING_FIELD");
    expect(mocks.createImageGenerationTask).not.toHaveBeenCalled();
  });

  it("does not spend when the monthly limit rejects the request", async () => {
    enableImageGeneration();
    mocks.enforceLimit.mockRejectedValue(
      Object.assign(new Error("limit"), { code: "PLAN_LIMIT_EXCEEDED" }),
    );

    const response = await POST(
      postJson("/api/tasks/image-generation", {
        prompt: "sushi boat",
        idempotencyKey: "request-1",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.createImageGenerationTask).not.toHaveBeenCalled();
  });
});
