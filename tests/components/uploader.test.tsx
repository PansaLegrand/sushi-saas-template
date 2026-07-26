import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Uploader from "@/components/storage/uploader";
import type { FileObject } from "@/types/storage";

const mocks = vi.hoisted(() => ({
  completeUpload: vi.fn(),
  createUpload: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/api/storage", () => ({
  completeUpload: mocks.completeUpload,
  createUpload: mocks.createUpload,
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "uploadLabel") return "Upload files";
    if (key === "hintPrivate") return `Private by default. Max size ${values?.mb} MB each.`;
    if (key.startsWith("status.")) return key.slice("status.".length);
    return key;
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

class SuccessfulXHR {
  status = 200;
  statusText = "OK";
  responseText = "";
  upload: { onprogress?: (evt: ProgressEvent) => void } = {};
  onload?: () => void;
  onerror?: () => void;

  open() {}
  setRequestHeader() {}
  send(file: File) {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: file.size,
      total: file.size,
    } as ProgressEvent);
    this.onload?.();
  }
}

function fileObject(overrides: Partial<FileObject> = {}): FileObject {
  return {
    id: 1,
    uuid: "file-1",
    user_uuid: "user-1",
    provider: "r2",
    bucket: "bucket",
    key: "uploads/report.pdf",
    region: "auto",
    endpoint: null,
    version_id: null,
    size: 1024,
    content_type: "application/pdf",
    etag: null,
    checksum_sha256: null,
    storage_class: null,
    original_filename: "report.pdf",
    extension: "pdf",
    visibility: "org",
    status: "active",
    metadata_json: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Uploader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("XMLHttpRequest", SuccessfulXHR);
    mocks.createUpload.mockResolvedValue({
      fileUuid: "file-1",
      bucket: "bucket",
      key: "uploads/report.pdf",
      uploadUrl: "https://storage.example/upload",
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      expiresIn: 900,
    });
    mocks.completeUpload.mockResolvedValue({ file: fileObject() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects files outside the selected policy before creating a presign", async () => {
    const { container } = render(<Uploader policy="images" multiple={false} />);
    const input = container.querySelector<HTMLInputElement>("input[type='file']");
    expect(input).toBeTruthy();
    expect(input).not.toHaveAttribute("multiple");
    expect(input).toHaveAttribute("accept", expect.stringContaining("image/png"));

    fireEvent.change(input!, {
      target: {
        files: [
          new File(["run"], "installer.exe", { type: "application/x-msdownload" }),
        ],
      },
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("That file type is not allowed.")
    );
    expect(mocks.createUpload).not.toHaveBeenCalled();
  });

  it("passes policy, visibility, and metadata through a successful upload", async () => {
    const user = userEvent.setup();
    const onUploaded = vi.fn();
    const source = new File(["pdf"], "report.pdf", { type: "application/pdf" });
    const { container } = render(
      <Uploader
        policy="documents"
        visibility="org"
        metadata={(file) => ({ purpose: "contract", originalName: file.name })}
        onUploaded={onUploaded}
      />
    );
    const input = container.querySelector<HTMLInputElement>("input[type='file']");

    await user.upload(input!, source);

    await waitFor(() => expect(mocks.completeUpload).toHaveBeenCalledWith("file-1"));
    expect(mocks.createUpload).toHaveBeenCalledWith({
      filename: "report.pdf",
      contentType: "application/pdf",
      size: source.size,
      policy: "documents",
      visibility: "org",
      checksumSha256: undefined,
      metadata: { purpose: "contract", originalName: "report.pdf" },
    });
    expect(onUploaded).toHaveBeenCalledWith(fileObject(), source);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("done");
  });
});
