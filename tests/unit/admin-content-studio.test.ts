import { describe, expect, it } from "vitest";

import { parseContentStudioUrl } from "@admin/lib/content-studio";

describe("parseContentStudioUrl", () => {
  it("accepts absolute HTTP and HTTPS studio origins", () => {
    expect(parseContentStudioUrl(" https://content.example.com/admin ")).toBe(
      "https://content.example.com/admin",
    );
    expect(parseContentStudioUrl("http://localhost:3002")).toBe(
      "http://localhost:3002/",
    );
  });

  it.each([
    undefined,
    "",
    "content.example.com",
    "/admin",
    "javascript:alert(1)",
    "ftp://content.example.com",
  ])("rejects an unsafe or non-absolute value: %s", (value) => {
    expect(parseContentStudioUrl(value)).toBeUndefined();
  });
});
