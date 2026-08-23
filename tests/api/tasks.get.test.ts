/**
 * Route contract for tenant-scoped task polling.
 *
 * Polling exposes signed private output URLs. Authentication must happen before
 * the presentation service can load a task or sign its storage object.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimitForTests } from "@/lib/rate-limit";
import { get } from "../helpers/request";

const mocks = vi.hoisted(() => ({
  getOrgContext: vi.fn<typeof import("@/services/authz").getOrgContext>(),
  getTaskRecord: vi.fn<
    typeof import("@/services/tasks/presentation").getTaskRecord
  >(),
}));

vi.mock("@/services/authz", () => ({ getOrgContext: mocks.getOrgContext }));
vi.mock("@/services/tasks/presentation", () => ({
  getTaskRecord: mocks.getTaskRecord,
}));

import { GET } from "@/app/api/tasks/[uuid]/route";

describe("GET /api/tasks/[uuid]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitForTests();
  });

  it("authenticates before loading or signing a task output", async () => {
    mocks.getOrgContext.mockResolvedValue(null);

    const response = await GET(get("/api/tasks/task-1"), {
      params: Promise.resolve({ uuid: "task-1" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.getTaskRecord).not.toHaveBeenCalled();
  });

  it("returns the tenant-scoped public task record", async () => {
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
    mocks.getTaskRecord.mockResolvedValue({
      uuid: "task-1",
      userUuid: "user-1",
      type: "image_generation",
      status: "succeeded",
      creditsUsed: 5,
      outputUrl: "https://storage.test/signed",
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:01.000Z",
    });

    const response = await GET(get("/api/tasks/task-1"), {
      params: Promise.resolve({ uuid: "task-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getTaskRecord).toHaveBeenCalledWith("task-1", "org-1");
    expect(payload.data.task.outputUrl).toBe("https://storage.test/signed");
  });
});
