/**
 * Request ids cross both an HTTP response boundary and the log boundary.
 * Keeping this normalization pure makes malformed or oversized caller values
 * impossible to propagate unnoticed.
 */
import { describe, expect, it } from "vitest";

import { normalizeRequestId } from "@/lib/logger/request-id";

describe("request id normalization", () => {
  it("keeps a bounded proxy id", () => {
    expect(normalizeRequestId("edge-01HZYK7Q2P")).toBe("edge-01HZYK7Q2P");
  });

  it.each([
    "",
    "short",
    "contains a space",
    "line\nbreak",
    "x".repeat(129),
  ])("replaces unsafe input %#", (value) => {
    expect(normalizeRequestId(value, () => "generated-request-id")).toBe(
      "generated-request-id"
    );
  });
});
