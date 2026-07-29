import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scheduleFileDeletion:
    vi.fn<typeof import("@/models/file").scheduleFileDeletion>(),
  findFileByUuid: vi.fn<typeof import("@/models/file").findFileByUuid>(),
  softDeleteFile: vi.fn<typeof import("@/models/file").softDeleteFile>(),
  deleteObject: vi.fn(),
}));

vi.mock("@/models/file", () => ({
  scheduleFileDeletion: mocks.scheduleFileDeletion,
  findFileByUuid: mocks.findFileByUuid,
  softDeleteFile: mocks.softDeleteFile,
}));

vi.mock("@/services/storage", () => ({
  getStorageAdapter: () => ({ deleteObject: mocks.deleteObject }),
}));

import { requestFileDeletion } from "@/services/storage/delete-request";
import { deleteStoredObject } from "@/services/storage/delete-worker";

const FILE = {
  uuid: "file-1",
  org_uuid: "org-1",
  status: "active",
  bucket: "bucket",
  key: "uploads/file-1",
};

describe("durable storage deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scheduleFileDeletion.mockResolvedValue({
      file: { ...FILE, status: "deleting" },
      queued: true,
    } as never);
    mocks.findFileByUuid.mockResolvedValue(FILE as never);
    mocks.softDeleteFile.mockResolvedValue({
      ...FILE,
      status: "deleted",
    } as never);
    mocks.deleteObject.mockResolvedValue(undefined);
  });

  it("atomically stops serving the row and queues provider deletion", async () => {
    await expect(requestFileDeletion(FILE, "org-1")).resolves.toMatchObject({
      file: expect.objectContaining({ uuid: "file-1" }),
      queued: true,
    });

    expect(mocks.scheduleFileDeletion).toHaveBeenCalledWith({
      uuid: "file-1",
      orgUuid: "org-1",
      expectedStatuses: undefined,
      patch: undefined,
      maxAttempts: 10,
    });
  });

  it("marks the row deleted only after the object provider succeeds", async () => {
    await deleteStoredObject({ fileUuid: "file-1", orgUuid: "org-1" });

    expect(mocks.deleteObject).toHaveBeenCalledWith({
      bucket: "bucket",
      key: "uploads/file-1",
    });
    expect(mocks.softDeleteFile).toHaveBeenCalledWith("file-1", "org-1");
  });

  it("leaves the row pending when provider deletion fails", async () => {
    mocks.deleteObject.mockRejectedValueOnce(new Error("provider down"));

    await expect(
      deleteStoredObject({ fileUuid: "file-1", orgUuid: "org-1" }),
    ).rejects.toThrow("provider down");

    expect(mocks.softDeleteFile).not.toHaveBeenCalled();
  });

  it("treats a worker replay after completion as success", async () => {
    mocks.findFileByUuid.mockResolvedValueOnce({
      ...FILE,
      status: "deleted",
    } as never);

    await expect(
      deleteStoredObject({ fileUuid: "file-1", orgUuid: "org-1" }),
    ).resolves.toBeUndefined();

    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });
});
