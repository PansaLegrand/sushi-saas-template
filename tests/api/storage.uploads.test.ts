/**
 * Storage upload routes guard private object access. If this file disappeared,
 * the presign endpoint could start accepting arbitrary file types or activating
 * objects whose provider metadata no longer matches the reservation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimitForTests } from "@/lib/rate-limit";
import { postJson } from "../helpers/request";

const mocks = vi.hoisted(() => ({
  findFileByUuid: vi.fn(),
  activateUploadingFile: vi.fn(),
  getOrgContext: vi.fn(),
  getPresignedUpload: vi.fn(),
  headObject: vi.fn(),
  listSubscriptionsByOrg: vi.fn(),
  notifySlackError: vi.fn(),
  requestFileDeletion: vi.fn(),
  reserveStorageUpload: vi.fn(),
  updateFileByUuid: vi.fn(),
}));

vi.mock("@/services/authz", () => ({
  getOrgContext: mocks.getOrgContext,
}));

vi.mock("@/models/file", () => ({
  findFileByUuid: mocks.findFileByUuid,
  activateUploadingFile: mocks.activateUploadingFile,
  updateFileByUuid: mocks.updateFileByUuid,
}));

vi.mock("@/services/storage/uploads", () => ({
  reserveStorageUpload: mocks.reserveStorageUpload,
}));

vi.mock("@/services/storage/delete-request", () => ({
  requestFileDeletion: mocks.requestFileDeletion,
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
    headObject: mocks.headObject,
    deleteObject: vi.fn(),
    getPresignedDownload: vi.fn(),
  }),
}));

vi.mock("@/models/subscription", async () => {
  const actual = await vi.importActual<typeof import("@/models/subscription")>(
    "@/models/subscription",
  );
  return {
    ...actual,
    listSubscriptionsByOrg: (...args: unknown[]) =>
      mocks.listSubscriptionsByOrg(...args),
  };
});

vi.mock("@/models/organization", async () => {
  const actual = await vi.importActual<typeof import("@/models/organization")>(
    "@/models/organization",
  );
  return {
    ...actual,
    findOrganizationMemberLimitOverride: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("@/integrations/slack", () => ({
  notifySlackError: mocks.notifySlackError,
}));

import { POST as completeUpload } from "@/app/api/storage/uploads/complete/route";
import { POST as createUpload } from "@/app/api/storage/uploads/route";

const VALID_SHA256 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const OTHER_SHA256 = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";

function orgContext() {
  return {
    userId: "id-user-test",
    userUuid: "user-test",
    orgId: "id-org-test",
    orgUuid: "org-test",
    orgSlug: "test-org",
    role: "owner",
  };
}

function subscriptionOn(tier: string) {
  const now = new Date();
  return {
    uuid: `sub-${tier}`,
    user_uuid: "user-test",
    tier,
    status: "active",
    source: "stripe",
    current_period_end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    cancel_at_period_end: false,
    ended_at: null,
    updated_at: now,
  };
}

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
    endpoint: "https://account.r2.cloudflarestorage.com",
    version_id: null,
    size: 100,
    content_type: "application/pdf",
    etag: null,
    checksum_sha256: null,
    storage_class: null,
    original_filename: "report.pdf",
    extension: "pdf",
    visibility: "private",
    status: "uploading",
    metadata_json: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    deleted_at: null,
    ...overrides,
  };
}

describe("POST /api/storage/uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitForTests();
    mocks.getOrgContext.mockResolvedValue(orgContext());
    mocks.getPresignedUpload.mockResolvedValue({
      fileUuid: "",
      bucket: "bucket",
      key: "uploads/user-test/report.pdf",
      uploadUrl: "https://storage.example/upload",
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      expiresIn: 900,
    });
    mocks.reserveStorageUpload.mockResolvedValue(storedFile());
    mocks.listSubscriptionsByOrg.mockResolvedValue([subscriptionOn("max")]);
  });

  it("rejects unauthenticated requests before touching storage data", async () => {
    mocks.getOrgContext.mockResolvedValue(null);

    const res = await createUpload(
      postJson("/api/storage/uploads", {
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 100,
      }),
    );

    expect(res.status).toBe(401);
    expect(mocks.reserveStorageUpload).not.toHaveBeenCalled();
    expect(mocks.getPresignedUpload).not.toHaveBeenCalled();
  });

  it("rejects multipart bodies before buffering an uploaded file", async () => {
    const body = new FormData();
    body.set("file", new File(["large payload"], "report.pdf"));

    const res = await createUpload(
      new Request("http://localhost:3000/api/storage/uploads", {
        method: "POST",
        body,
      }),
    );
    const payload = await res.json();

    expect(res.status).toBe(415);
    expect(payload.error_code).toBe("REQUEST_UNSUPPORTED_MEDIA_TYPE");
    expect(mocks.reserveStorageUpload).not.toHaveBeenCalled();
  });

  it("rejects disallowed file types before reserving a row", async () => {
    const res = await createUpload(
      postJson("/api/storage/uploads", {
        filename: "installer.exe",
        contentType: "application/x-msdownload",
        size: 100,
      }),
    );
    const payload = await res.json();

    expect(res.status).toBe(415);
    expect(payload.error_code).toBe("STORAGE_FILE_TYPE_NOT_ALLOWED");
    expect(mocks.listSubscriptionsByOrg).not.toHaveBeenCalled();
    expect(mocks.reserveStorageUpload).not.toHaveBeenCalled();
    expect(mocks.getPresignedUpload).not.toHaveBeenCalled();
  });

  it("requires a checksum for verified uploads", async () => {
    const res = await createUpload(
      postJson("/api/storage/uploads", {
        filename: "report.pdf",
        contentType: "application/pdf",
        policy: "verified",
        size: 100,
      }),
    );
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload.error_code).toBe("STORAGE_CHECKSUM_REQUIRED");
    expect(mocks.reserveStorageUpload).not.toHaveBeenCalled();
  });

  it("creates a private presigned upload with policy metadata and checksum", async () => {
    const res = await createUpload(
      postJson("/api/storage/uploads", {
        filename: "report.pdf",
        contentType: "application/pdf; charset=utf-8",
        policy: "documents",
        visibility: "org",
        size: 100,
        checksumSha256: VALID_SHA256,
        metadata: { entity: "invoice" },
      }),
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.data.uploadUrl).toBe("https://storage.example/upload");
    expect(mocks.reserveStorageUpload).toHaveBeenCalledWith(
      "org-test",
      expect.objectContaining({
        org_uuid: "org-test",
        provider: "r2",
        bucket: "bucket",
        key: "uploads/user-test/report.pdf",
        original_filename: "report.pdf",
        extension: "pdf",
        content_type: "application/pdf",
        visibility: "org",
        status: "uploading",
        checksum_sha256: VALID_SHA256,
        metadata_json: JSON.stringify({
          entity: "invoice",
          upload_policy: "documents",
        }),
      }),
    );
    expect(mocks.getPresignedUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "bucket",
        key: "uploads/user-test/report.pdf",
        contentType: "application/pdf",
        checksumSha256: VALID_SHA256,
      }),
    );
  });

  it("applies the upload policy max size in addition to plan and env limits", async () => {
    const res = await createUpload(
      postJson("/api/storage/uploads", {
        filename: "large.png",
        contentType: "image/png",
        policy: "images",
        size: 11 * 1024 * 1024,
      }),
    );
    const payload = await res.json();

    expect(res.status).toBe(413);
    expect(payload.error_code).toBe("STORAGE_FILE_TOO_LARGE");
    expect(payload.details).toEqual({ maxBytes: 10 * 1024 * 1024 });
    expect(mocks.reserveStorageUpload).not.toHaveBeenCalled();
  });
});

describe("POST /api/storage/uploads/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitForTests();
    mocks.getOrgContext.mockResolvedValue(orgContext());
    mocks.findFileByUuid.mockResolvedValue(storedFile());
    mocks.headObject.mockResolvedValue({
      size: 100,
      etag: '"etag"',
      contentType: "application/pdf",
      checksumSHA256: VALID_SHA256,
      storageClass: undefined,
    });
    mocks.activateUploadingFile.mockResolvedValue(
      storedFile({ status: "active" }),
    );
    mocks.requestFileDeletion.mockResolvedValue({
      file: storedFile({ status: "deleting" }),
      queued: true,
    });
  });

  it("rejects unauthenticated completion before reading the file row", async () => {
    mocks.getOrgContext.mockResolvedValue(null);

    const res = await completeUpload(
      postJson("/api/storage/uploads/complete", { fileUuid: "file-test" }),
    );

    expect(res.status).toBe(401);
    expect(mocks.findFileByUuid).not.toHaveBeenCalled();
    expect(mocks.headObject).not.toHaveBeenCalled();
  });

  it("durably deletes the upload when the provider checksum differs", async () => {
    mocks.findFileByUuid.mockResolvedValue(
      storedFile({ checksum_sha256: VALID_SHA256 }),
    );
    mocks.headObject.mockResolvedValue({
      size: 100,
      etag: '"etag"',
      contentType: "application/pdf",
      checksumSHA256: OTHER_SHA256,
      storageClass: "STANDARD",
    });

    const res = await completeUpload(
      postJson("/api/storage/uploads/complete", { fileUuid: "file-test" }),
    );
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload.error_code).toBe("STORAGE_CHECKSUM_MISMATCH");
    expect(mocks.requestFileDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ uuid: "file-test", status: "uploading" }),
      "org-test",
      {
        expectedStatuses: ["uploading"],
        patch: expect.objectContaining({
          checksum_sha256: OTHER_SHA256,
        }),
      },
    );
    expect(mocks.updateFileByUuid).not.toHaveBeenCalled();
  });

  it("does not reactivate an upload after cleanup wins the race", async () => {
    mocks.activateUploadingFile.mockResolvedValueOnce(undefined);

    const res = await completeUpload(
      postJson("/api/storage/uploads/complete", { fileUuid: "file-test" }),
    );
    const payload = await res.json();

    expect(res.status).toBe(409);
    expect(payload.error_code).toBe("STORAGE_UPLOAD_STATE_CONFLICT");
    expect(mocks.activateUploadingFile).toHaveBeenCalledWith(
      "file-test",
      "org-test",
      expect.not.objectContaining({ status: "active" }),
    );
  });
});
