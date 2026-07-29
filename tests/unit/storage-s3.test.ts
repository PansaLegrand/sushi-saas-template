import { describe, expect, it } from "vitest";

import { isStorageObjectNotFound } from "@/services/storage/s3";

describe("S3 object lookup errors", () => {
  it.each([
    { name: "NotFound" },
    { name: "NoSuchKey" },
    { Code: "NoSuchKey" },
    { $metadata: { httpStatusCode: 404 } },
  ])("recognizes a missing object", (error) => {
    expect(isStorageObjectNotFound(error)).toBe(true);
  });

  it("does not disguise provider outages as a missing object", () => {
    expect(
      isStorageObjectNotFound({
        name: "ServiceUnavailable",
        $metadata: { httpStatusCode: 503 },
      }),
    ).toBe(false);
  });
});
