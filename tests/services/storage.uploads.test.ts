import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanupStaleUploads:
    vi.fn<typeof import("@/services/storage/cleanup").cleanupStaleUploads>(),
  limitOf: vi.fn<typeof import("@/services/entitlements").limitOf>(),
  enforceLimit:
    vi.fn<typeof import("@/services/entitlements").enforceLimit>(),
  reserveFileWithinQuota:
    vi.fn<typeof import("@/models/file").reserveFileWithinQuota>(),
}));

vi.mock("@/services/storage/cleanup", () => ({
  cleanupStaleUploads: mocks.cleanupStaleUploads,
}));

vi.mock("@/services/entitlements", () => ({
  limitOf: mocks.limitOf,
  enforceLimit: mocks.enforceLimit,
}));

vi.mock("@/models/file", () => ({
  reserveFileWithinQuota: mocks.reserveFileWithinQuota,
}));

import { reserveStorageUpload } from "@/services/storage/uploads";

const DATA = {
  uuid: "file-1",
  org_uuid: "org-1",
  user_uuid: "user-1",
  bucket: "bucket",
  key: "uploads/file-1",
  original_filename: "file.txt",
  content_type: "text/plain",
  size: 2 * 1024 * 1024,
};

describe("reserveStorageUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cleanupStaleUploads.mockResolvedValue(0);
    mocks.limitOf.mockResolvedValue(100);
    mocks.reserveFileWithinQuota.mockResolvedValue({
      ok: true,
      file: DATA as never,
      usedBytes: 0,
    });
    mocks.enforceLimit.mockResolvedValue(undefined);
  });

  it("passes the exact byte cap to the atomic reservation", async () => {
    await reserveStorageUpload("org-1" as never, DATA);

    expect(mocks.reserveFileWithinQuota).toHaveBeenCalledWith(
      DATA,
      100 * 1024 * 1024
    );
  });

  it("reports the usage observed by the refusing transaction", async () => {
    mocks.reserveFileWithinQuota.mockResolvedValueOnce({
      ok: false,
      usedBytes: 99 * 1024 * 1024,
    });
    mocks.enforceLimit.mockRejectedValueOnce(
      Object.assign(new Error("limit"), { code: "PLAN_LIMIT_EXCEEDED" })
    );

    await expect(
      reserveStorageUpload("org-1" as never, DATA)
    ).rejects.toMatchObject({ code: "PLAN_LIMIT_EXCEEDED" });

    expect(mocks.enforceLimit).toHaveBeenCalledWith(
      "org-1",
      "storage.totalMb",
      { current: 99, adding: 2 }
    );
  });
});
