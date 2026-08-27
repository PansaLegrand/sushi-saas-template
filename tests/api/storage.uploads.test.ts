/**
 * Storage upload routes guard private object access. If this file disappeared,
 * the presign endpoint could start accepting arbitrary file types or activating
 * objects whose provider metadata no longer matches the reservation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors/app-error";
import { resetRateLimitForTests } from "@/lib/rate-limit";
import { postJson } from "../helpers/request";

const mocks = vi.hoisted(() => ({
  completeStorageUpload: vi.fn(),
  createStorageUpload: vi.fn(),
  getOrgContext: vi.fn(),
  notifySlackError: vi.fn(),
}));

vi.mock("@/services/authz", () => ({
  getOrgContext: mocks.getOrgContext,
}));

vi.mock("@/services/storage/uploads", () => ({
  createStorageUpload: mocks.createStorageUpload,
}));

vi.mock("@/services/storage/complete-upload", () => ({
  completeStorageUpload: mocks.completeStorageUpload,
}));

vi.mock("@/integrations/slack", () => ({
  notifySlackError: mocks.notifySlackError,
}));

import { POST as completeUpload } from "@/app/api/storage/uploads/complete/route";
import { POST as createUpload } from "@/app/api/storage/uploads/route";

const VALID_SHA256 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

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
    mocks.createStorageUpload.mockResolvedValue({
      upload: {
        fileUuid: "file-test",
        bucket: "bucket",
        key: "uploads/user-test/report.pdf",
        uploadUrl: "https://storage.example/upload",
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        expiresIn: 900,
      },
      contentType: "application/pdf",
    });
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
    expect(mocks.createStorageUpload).not.toHaveBeenCalled();
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
    expect(mocks.createStorageUpload).not.toHaveBeenCalled();
  });

  it("rejects disallowed file types before reserving a row", async () => {
    mocks.createStorageUpload.mockRejectedValue(
      new AppError("STORAGE_FILE_TYPE_NOT_ALLOWED"),
    );
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
    expect(mocks.createStorageUpload).toHaveBeenCalledOnce();
  });

  it("normalizes legacy field aliases and a string size through the schema", async () => {
    const res = await createUpload(
      postJson("/api/storage/uploads", {
        name: "report.pdf",
        type: "application/pdf",
        size: "100",
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.createStorageUpload).toHaveBeenCalledWith({
      orgUuid: "org-test",
      userUuid: "user-test",
      filename: "report.pdf",
      contentType: "application/pdf",
      size: 100,
      checksumSha256: undefined,
      policy: undefined,
      visibility: undefined,
      metadata: undefined,
    });
  });

  it("requires a checksum for verified uploads", async () => {
    mocks.createStorageUpload.mockRejectedValue(
      new AppError("STORAGE_CHECKSUM_REQUIRED"),
    );
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
    expect(mocks.createStorageUpload).toHaveBeenCalledOnce();
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
    expect(mocks.createStorageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        orgUuid: "org-test",
        userUuid: "user-test",
        filename: "report.pdf",
        contentType: "application/pdf; charset=utf-8",
        visibility: "org",
        checksumSha256: VALID_SHA256,
        metadata: { entity: "invoice" },
      }),
    );
  });

  it("applies the upload policy max size in addition to plan and env limits", async () => {
    mocks.createStorageUpload.mockRejectedValue(
      new AppError("STORAGE_FILE_TOO_LARGE", {
        details: { maxBytes: 10 * 1024 * 1024 },
      }),
    );
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
    expect(mocks.createStorageUpload).toHaveBeenCalledOnce();
  });
});

describe("POST /api/storage/uploads/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitForTests();
    mocks.getOrgContext.mockResolvedValue(orgContext());
    mocks.completeStorageUpload.mockResolvedValue(
      storedFile({ status: "active" }),
    );
  });

  it("rejects unauthenticated completion before reading the file row", async () => {
    mocks.getOrgContext.mockResolvedValue(null);

    const res = await completeUpload(
      postJson("/api/storage/uploads/complete", { fileUuid: "file-test" }),
    );

    expect(res.status).toBe(401);
    expect(mocks.completeStorageUpload).not.toHaveBeenCalled();
  });

  it("returns the service's catalogued integrity failure", async () => {
    mocks.completeStorageUpload.mockRejectedValue(
      new AppError("STORAGE_CHECKSUM_MISMATCH"),
    );

    const res = await completeUpload(
      postJson("/api/storage/uploads/complete", { fileUuid: "file-test" }),
    );
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload.error_code).toBe("STORAGE_CHECKSUM_MISMATCH");
    expect(mocks.completeStorageUpload).toHaveBeenCalledWith(
      "org-test",
      "file-test",
    );
  });

  it("returns a successful service result in the API envelope", async () => {
    const res = await completeUpload(
      postJson("/api/storage/uploads/complete", { fileUuid: "file-test" }),
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.data.file).toMatchObject({
      uuid: "file-test",
      status: "active",
    });
  });
});
