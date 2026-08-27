/**
 * Upload creation combines capability checks, byte-accurate quota reservation,
 * policy validation, and provider signing. These tests keep those decisions in
 * one service and prove invalid uploads never reserve storage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanupStaleUploads:
    vi.fn<typeof import("@/services/storage/cleanup").cleanupStaleUploads>(),
  limitOf: vi.fn<typeof import("@/services/entitlements").limitOf>(),
  enforceLimit: vi.fn<typeof import("@/services/entitlements").enforceLimit>(),
  requireEntitlement:
    vi.fn<typeof import("@/services/entitlements").requireEntitlement>(),
  reserveFileWithinQuota:
    vi.fn<typeof import("@/models/file").reserveFileWithinQuota>(),
  getPresignedUpload: vi.fn(),
}));

vi.mock("@/services/storage/cleanup", () => ({
  cleanupStaleUploads: mocks.cleanupStaleUploads,
}));

vi.mock("@/services/entitlements", () => ({
  limitOf: mocks.limitOf,
  enforceLimit: mocks.enforceLimit,
  requireEntitlement: mocks.requireEntitlement,
}));

vi.mock("@/models/file", () => ({
  reserveFileWithinQuota: mocks.reserveFileWithinQuota,
}));

vi.mock("@/services/storage", () => ({
  getStorageAdapter: () => ({
    provider: "r2",
    getDefaultBucket: () => "bucket",
    buildObjectKey: ({
      userUuid,
      filename,
    }: {
      userUuid: string;
      filename: string;
    }) => `uploads/${userUuid}/${filename}`,
    getPresignedUpload: mocks.getPresignedUpload,
  }),
}));

import {
  createStorageUpload,
  reserveStorageUpload,
} from "@/services/storage/uploads";

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
  mocks.requireEntitlement.mockResolvedValue(
    {} as Awaited<ReturnType<typeof mocks.requireEntitlement>>,
  );
  mocks.getPresignedUpload.mockResolvedValue({
    fileUuid: "provider-value-is-replaced",
    bucket: "bucket",
    key: "uploads/user-1/report.pdf",
    uploadUrl: "https://storage.example/upload",
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    expiresIn: 900,
  });
});

describe("reserveStorageUpload", () => {
  it("passes the exact byte cap to the atomic reservation", async () => {
    await reserveStorageUpload("org-1" as never, DATA);

    expect(mocks.reserveFileWithinQuota).toHaveBeenCalledWith(
      DATA,
      100 * 1024 * 1024,
    );
  });

  it("reports the usage observed by the refusing transaction", async () => {
    mocks.reserveFileWithinQuota.mockResolvedValueOnce({
      ok: false,
      usedBytes: 99 * 1024 * 1024,
    });
    mocks.enforceLimit.mockRejectedValueOnce(
      Object.assign(new Error("limit"), { code: "PLAN_LIMIT_EXCEEDED" }),
    );

    await expect(
      reserveStorageUpload("org-1" as never, DATA),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT_EXCEEDED" });

    expect(mocks.enforceLimit).toHaveBeenCalledWith(
      "org-1",
      "storage.totalMb",
      { current: 99, adding: 2 },
    );
  });
});

describe("createStorageUpload", () => {
  it("rejects a disallowed type before entitlement or quota work", async () => {
    await expect(
      createStorageUpload({
        orgUuid: "org-1" as never,
        userUuid: "user-1",
        filename: "installer.exe",
        contentType: "application/x-msdownload",
        size: 100,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_FILE_TYPE_NOT_ALLOWED" });

    expect(mocks.requireEntitlement).not.toHaveBeenCalled();
    expect(mocks.reserveFileWithinQuota).not.toHaveBeenCalled();
  });

  it("enforces the selected policy's checksum and size rules", async () => {
    await expect(
      createStorageUpload({
        orgUuid: "org-1" as never,
        userUuid: "user-1",
        filename: "report.pdf",
        contentType: "application/pdf",
        policy: "verified",
        size: 100,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_CHECKSUM_REQUIRED" });

    await expect(
      createStorageUpload({
        orgUuid: "org-1" as never,
        userUuid: "user-1",
        filename: "large.png",
        contentType: "image/png",
        policy: "images",
        size: 11 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      code: "STORAGE_FILE_TOO_LARGE",
      details: { maxBytes: 10 * 1024 * 1024 },
    });

    expect(mocks.reserveFileWithinQuota).not.toHaveBeenCalled();
  });

  it("normalizes metadata once before reservation and provider signing", async () => {
    const checksum = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    const result = await createStorageUpload({
      orgUuid: "org-1" as never,
      userUuid: "user-1",
      filename: "report.pdf",
      contentType: "application/pdf; charset=utf-8",
      policy: "documents",
      visibility: "org",
      size: 100,
      checksumSha256: checksum,
      metadata: { entity: "invoice" },
    });

    expect(result).toMatchObject({
      upload: {
        fileUuid: expect.any(String),
        uploadUrl: "https://storage.example/upload",
      },
      contentType: "application/pdf",
    });
    expect(mocks.reserveFileWithinQuota).toHaveBeenCalledWith(
      expect.objectContaining({
        org_uuid: "org-1",
        user_uuid: "user-1",
        original_filename: "report.pdf",
        extension: "pdf",
        content_type: "application/pdf",
        visibility: "org",
        checksum_sha256: checksum,
        metadata_json: JSON.stringify({
          entity: "invoice",
          upload_policy: "documents",
        }),
      }),
      100 * 1024 * 1024,
    );
    expect(mocks.getPresignedUpload).toHaveBeenCalledWith({
      bucket: "bucket",
      key: "uploads/user-1/report.pdf",
      contentType: "application/pdf",
      size: 100,
      checksumSha256: checksum,
      metadata: { entity: "invoice" },
      expiresIn: 900,
    });
  });
});
