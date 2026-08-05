import { describe, expect, it } from "vitest";
import { safePublicHref, safeSitePath } from "@/lib/public-urls";

describe("public content URLs", () => {
  it.each([
    ["/pricing", "/pricing"],
    ["/docs/start?from=cms", "/docs/start?from=cms"],
    ["#calculator", "#calculator"],
    ["https://example.com/start", "https://example.com/start"],
    ["mailto:team@example.com", "mailto:team@example.com"]
  ])("accepts a safe CTA destination: %s", (value, expected) => {
    expect(safePublicHref(value)).toBe(expected);
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "//evil.example/path", "/\\evil.example"])(
    "rejects an unsafe CTA destination: %s",
    (value) => expect(safePublicHref(value)).toBeNull()
  );

  it("requires canonical overrides to stay on the public site", () => {
    expect(safeSitePath("/guides/example")).toBe("/guides/example");
    expect(safeSitePath("//evil.example/example")).toBeNull();
    expect(safeSitePath("https://evil.example/example")).toBeNull();
  });
});
