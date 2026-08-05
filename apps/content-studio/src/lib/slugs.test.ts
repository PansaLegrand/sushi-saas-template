import { describe, expect, it } from "vitest";
import { isValidPageSlug, isValidSlug, normalizeSlug } from "@/lib/slugs";

describe("content slugs", () => {
  it("normalizes nested paths without permitting code-like characters", () => {
    expect(normalizeSlug(" Tools / ROI Calculator ")).toBe("tools/roi-calculator");
    expect(isValidSlug("tools/roi-calculator")).toBe(true);
    expect(isValidSlug("tools/<script>")).not.toBe(true);
  });

  it("keeps CMS pages away from routes owned by the public application", () => {
    expect(isValidPageSlug("tools/roi-calculator")).toBe(true);
    expect(isValidPageSlug("docs/generated-guide")).not.toBe(true);
    expect(isValidPageSlug("blogs/generated-article")).not.toBe(true);
  });
});
