/**
 * Upload completion is the integrity boundary between a reserved database row
 * and provider-owned bytes. These tests prove mismatches are deleted durably
 * and a cleanup race cannot reactivate a stale upload.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFileByUuid: vi.fn<typeof import("@/models/file").findFileByUuid>(),
  activateUploadingFile:
    vi.fn<typeof import("@/models/file").activateUploadingFile>(),
  headObject: vi.fn(),
  requestFileDeletion:
    vi.fn<
      typeof import("@/services/storage/delete-request").requestFileDeletion
    >(),
}));

vi.mock("@/models/file", () => ({
  findFileByUuid: mocks.findFileByUuid,
  activateUploadingFile: mocks.activateUploadingFile,
}));
vi.mock("@/services/storage", () => ({
  getStorageAdapter: () => ({ headObject: mocks.headObject }),
}));
vi.mock("@/services/storage/delete-request", () => ({
  requestFileDeletion: mocks.requestFileDeletion,
}));

import { completeStorageUpload } from "@/services/storage/complete-upload";

const VALID_SHA256 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const OTHER_SHA256 = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";

function storedFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    uuid: "file-test",
    user_uuid: "user-test",
    org_uuid: "org-test",
    provider: "r2",
    bucket: "bucket",
    key: "uploads/user-test/report.pdf",
    region: "auto",
    endpoint: null,
    version_id: null,
    size: 100,
    content_type: "application/pdf",
    original_filename: "report.pdf",
    extension: "pdf",
    visibility: "private",
    status: "uploading",
    checksum_sha256: VALID_SHA256,
    etag: null,
    storage_class: null,
    metadata_json: null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...overrides,
  } as NonNullable<Awaited<ReturnType<typeof mocks.findFileByUuid>>>;
}

describe("completeStorageUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFileByUuid.mockResolvedValue(storedFile());
    mocks.headObject.mockResolvedValue({
      size: 100,
      etag: '"etag"',
      contentType: "application/pdf",
      checksumSHA256: VALID_SHA256,
      storageClass: "STANDARD",
    });
    mocks.activateUploadingFile.mockResolvedValue(
      storedFile({ status: "active", etag: '"etag"' }),
    );
    mocks.requestFileDeletion.mockResolvedValue({
      file: storedFile({ status: "deleting" }),
      queued: true,
    });
  });

  it("activates a verified provider object with normalized metadata", async () => {
    const result = await completeStorageUpload("org-test", "file-test");

    expect(result.status).toBe("active");
    expect(mocks.activateUploadingFile).toHaveBeenCalledWith(
      "file-test",
      "org-test",
      {
        size: 100,
        etag: '"etag"',
        content_type: "application/pdf",
        checksum_sha256: VALID_SHA256,
        storage_class: "STANDARD",
      },
    );
  });

  it("returns an already active row without calling the provider", async () => {
    mocks.findFileByUuid.mockResolvedValue(storedFile({ status: "active" }));

    const result = await completeStorageUpload("org-test", "file-test");

    expect(result.status).toBe("active");
    expect(mocks.headObject).not.toHaveBeenCalled();
    expect(mocks.activateUploadingFile).not.toHaveBeenCalled();
  });

  it("durably deletes an upload whose provider checksum differs", async () => {
    mocks.headObject.mockResolvedValue({
      size: 100,
      etag: '"etag"',
      contentType: "application/pdf",
      checksumSHA256: OTHER_SHA256,
      storageClass: "STANDARD",
    });

    await expect(
      completeStorageUpload("org-test", "file-test"),
    ).rejects.toMatchObject({ code: "STORAGE_CHECKSUM_MISMATCH" });
    expect(mocks.requestFileDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: "file-test", status: "uploading" }),
      "org-test",
      {
        expectedStatuses: ["uploading"],
        patch: expect.objectContaining({ checksum_sha256: OTHER_SHA256 }),
      },
    );
    expect(mocks.activateUploadingFile).not.toHaveBeenCalled();
  });

  it("does not reactivate an upload after cleanup wins the race", async () => {
    mocks.activateUploadingFile.mockResolvedValue(undefined);

    await expect(
      completeStorageUpload("org-test", "file-test"),
    ).rejects.toMatchObject({ code: "STORAGE_UPLOAD_STATE_CONFLICT" });
  });
});
