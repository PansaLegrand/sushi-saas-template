/**
 * Public task projection and private output delivery.
 *
 * Task rows store stable file identities, never expiring URLs. This test pins
 * tenant-scoped file lookup and just-in-time signing without exposing bucket or
 * object keys in the task contract.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTaskByUuid: vi.fn<typeof import("@/models/task").findTaskByUuid>(),
  findFileByUuid: vi.fn<typeof import("@/models/file").findFileByUuid>(),
  getPresignedDownload: vi.fn(),
}));

vi.mock("@/models/task", () => ({ findTaskByUuid: mocks.findTaskByUuid }));
vi.mock("@/models/file", () => ({ findFileByUuid: mocks.findFileByUuid }));
vi.mock("@/services/storage", () => ({
  getStorageAdapter: () => ({
    getPresignedDownload: mocks.getPresignedDownload,
  }),
}));

import { getTaskRecord, toTaskRecord } from "@/services/tasks/presentation";

const now = new Date("2026-08-24T00:00:00.000Z");
const task = {
  id: 1,
  uuid: "task-1",
  user_uuid: "user-1",
  org_uuid: "org-1",
  type: "image_generation",
  status: "succeeded",
  credits_used: 5,
  credits_trans_no: "task_image:task-1",
  idempotency_key: "request-1",
  request_fingerprint: "fingerprint",
  job_uuid: "job-1",
  output_file_uuid: "file-1",
  user_input: JSON.stringify({ prompt: "sushi" }),
  output_url: null,
  output_json: JSON.stringify({ file_uuid: "file-1" }),
  error_message: null,
  started_at: now,
  completed_at: now,
  created_at: now,
  updated_at: now,
} as import("@/models/task").TaskRow;

describe("task presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFileByUuid.mockResolvedValue({
      uuid: "file-1",
      org_uuid: "org-1",
      bucket: "private",
      key: "generated/org-1/task-1.svg",
      content_type: "image/svg+xml",
      status: "active",
    } as never);
    mocks.getPresignedDownload.mockResolvedValue({
      url: "https://storage.test/signed",
      expiresIn: 900,
    });
  });

  it("signs an active output only after a tenant-scoped file lookup", async () => {
    const record = await toTaskRecord(task);

    expect(mocks.findFileByUuid).toHaveBeenCalledWith("file-1", "org-1");
    expect(mocks.getPresignedDownload).toHaveBeenCalledWith({
      bucket: "private",
      key: "generated/org-1/task-1.svg",
      expiresIn: 900,
      responseContentType: "image/svg+xml",
    });
    expect(record.outputUrl).toBe("https://storage.test/signed");
    expect(record).not.toHaveProperty("bucket");
    expect(record).not.toHaveProperty("key");
  });

  it("returns nothing without loading file or storage for an unknown task", async () => {
    mocks.findTaskByUuid.mockResolvedValue(undefined);

    expect(await getTaskRecord("task-missing", "org-1")).toBeUndefined();
    expect(mocks.findFileByUuid).not.toHaveBeenCalled();
    expect(mocks.getPresignedDownload).not.toHaveBeenCalled();
  });
});
