import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FilesList from "@/components/storage/files-list";
import type { FileObject } from "@/types/storage";

const mocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  getDownloadUrl: vi.fn(),
  listFiles: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/api/storage", () => ({
  deleteFile: mocks.deleteFile,
  getDownloadUrl: mocks.getDownloadUrl,
  listFiles: mocks.listFiles,
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

function file(overrides: Partial<FileObject> = {}): FileObject {
  return {
    id: 1,
    uuid: "file-1",
    user_uuid: "user-1",
    provider: "s3",
    bucket: "bucket",
    key: "uploads/report.pdf",
    region: null,
    endpoint: null,
    version_id: null,
    size: 1024,
    content_type: "application/pdf",
    etag: null,
    checksum_sha256: null,
    storage_class: null,
    original_filename: "report.pdf",
    extension: "pdf",
    visibility: "private",
    status: "active",
    metadata_json: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("FilesList", () => {
  it("confirms deletion in an accessible dialog", async () => {
    const user = userEvent.setup();
    mocks.listFiles.mockResolvedValue({ items: [file()] });
    mocks.deleteFile.mockResolvedValue({});
    const confirmSpy = vi.spyOn(window, "confirm");

    render(<FilesList />);

    expect(await screen.findByText("report.pdf")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete/i }));

    const dialog = await screen.findByRole("dialog", { name: "Delete file?" });
    expect(dialog).toHaveAccessibleDescription(/report\.pdf/i);
    expect(confirmSpy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /delete/i }));

    await waitFor(() => expect(mocks.deleteFile).toHaveBeenCalledWith("file-1"));
    await waitFor(() => expect(screen.queryByText("report.pdf")).not.toBeInTheDocument());
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Deleted");
  });
});
