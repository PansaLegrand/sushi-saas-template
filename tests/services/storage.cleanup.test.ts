/**
 * Stale upload cleanup keeps abandoned presign reservations from permanently
 * counting against storage quota. If this file disappeared, a refactor could
 * quietly change the cutoff window or drop org scoping.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markStaleUploadingFilesFailed: vi.fn(),
}));

vi.mock("@/models/file", () => ({
  markStaleUploadingFilesFailed: mocks.markStaleUploadingFilesFailed,
}));

import {
  STALE_UPLOAD_AFTER_MS,
  cleanupStaleUploads,
  staleUploadCutoff,
} from "@/services/storage/cleanup";

describe("cleanupStaleUploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markStaleUploadingFilesFailed.mockResolvedValue(3);
  });

  it("uses a one-hour cutoff", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");

    expect(staleUploadCutoff(now).getTime()).toBe(
      now.getTime() - STALE_UPLOAD_AFTER_MS
    );
  });

  it("marks stale uploading rows failed for a single org when scoped", async () => {
    const now = new Date("2026-01-01T12:00:00.000Z");

    await expect(
      cleanupStaleUploads({ orgUuid: "org-test", now })
    ).resolves.toBe(3);

    expect(mocks.markStaleUploadingFilesFailed).toHaveBeenCalledWith({
      orgUuid: "org-test",
      cutoff: new Date("2026-01-01T11:00:00.000Z"),
    });
  });
});
