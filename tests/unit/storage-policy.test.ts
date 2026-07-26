/**
 * Storage upload policies are the shared contract between the presign route and
 * reusable uploader. If this file disappeared, a UI-only accept list could drift
 * away from what the server actually allows.
 */
import { describe, expect, it } from "vitest";

import {
  getStorageUploadPolicy,
  isAllowedUploadType,
  isSha256Checksum,
  matchesAcceptToken,
  normalizeContentType,
} from "@/config/storage";

describe("storage upload policy", () => {
  it("normalizes content types before matching", () => {
    expect(normalizeContentType(" Image/PNG ; charset=utf-8 ")).toBe("image/png");
  });

  it("requires both an allowed content type and an allowed extension when an extension exists", () => {
    const images = getStorageUploadPolicy("images");

    expect(
      isAllowedUploadType(images, {
        filename: "avatar.png",
        contentType: "image/png",
      })
    ).toBe(true);

    expect(
      isAllowedUploadType(images, {
        filename: "avatar.exe",
        contentType: "image/png",
      })
    ).toBe(false);
  });

  it("supports wildcard and extension accept tokens for the client picker", () => {
    expect(
      matchesAcceptToken({
        token: "image/*",
        filename: "avatar.png",
        contentType: "image/png",
      })
    ).toBe(true);

    expect(
      matchesAcceptToken({
        token: ".pdf",
        filename: "contract.pdf",
        contentType: "application/octet-stream",
      })
    ).toBe(true);
  });

  it("recognizes standard base64 sha256 checksums", () => {
    expect(isSha256Checksum("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")).toBe(true);
    expect(isSha256Checksum("not-a-checksum")).toBe(false);
  });
});
