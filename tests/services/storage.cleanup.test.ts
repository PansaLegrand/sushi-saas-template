/**
 * Stale upload cleanup keeps abandoned presign reservations from permanently
 * counting against storage quota. If this file disappeared, a refactor could
 * quietly change the cutoff window or drop org scoping.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listStaleUploadingFiles: vi.fn(),
  scheduleFileDeletion: vi.fn(),
}));

vi.mock("@/models/file", () => ({
  listStaleUploadingFiles: mocks.listStaleUploadingFiles,
  scheduleFileDeletion: mocks.scheduleFileDeletion,
}));

import {
  STALE_UPLOAD_AFTER_MS,
  cleanupStaleUploads,
  staleUploadCutoff,
} from "@/services/storage/cleanup";

describe("cleanupStaleUploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listStaleUploadingFiles.mockResolvedValue([
      { uuid: "file-1", org_uuid: "org-test", status: "uploading" },
      { uuid: "file-2", org_uuid: "org-test", status: "uploading" },
      { uuid: "file-3", org_uuid: "org-test", status: "uploading" },
    ]);
    mocks.scheduleFileDeletion.mockImplementation(async ({ uuid }) => ({
      file: { uuid, org_uuid: "org-test", status: "deleting" },
      queued: true,
    }));
  });

  it("uses a one-hour cutoff", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");

    expect(staleUploadCutoff(now).getTime()).toBe(
      now.getTime() - STALE_UPLOAD_AFTER_MS,
    );
  });

  it("durably queues stale provider objects for deletion when scoped", async () => {
    const now = new Date("2026-01-01T12:00:00.000Z");

    await expect(
      cleanupStaleUploads({ orgUuid: "org-test", now }),
    ).resolves.toBe(3);

    expect(mocks.listStaleUploadingFiles).toHaveBeenCalledWith({
      orgUuid: "org-test",
      cutoff: new Date("2026-01-01T11:00:00.000Z"),
    });
    expect(mocks.scheduleFileDeletion).toHaveBeenCalledTimes(3);
    expect(mocks.scheduleFileDeletion).toHaveBeenCalledWith({
      uuid: "file-1",
      orgUuid: "org-test",
      expectedStatuses: ["uploading"],
      patch: undefined,
      maxAttempts: 10,
    });
  });
});
