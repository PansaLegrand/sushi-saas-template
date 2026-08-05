import { describe, expect, it } from "vitest";
import { batchImportSchema, portableDraftSchema } from "@/content-api/schemas";

const baseDraft = {
  collection: "pages" as const,
  locale: "en" as const,
  slug: "tools/word-counter",
  title: "Free word counter",
  summary: "Count words and characters in the browser.",
  template: "content-with-tool" as const,
  blocks: [
    {
      type: "tool" as const,
      toolKey: "word-counter" as const,
      heading: "Word counter"
    }
  ]
};

describe("portable content schema", () => {
  it("accepts a registered interactive tool", () => {
    const result = portableDraftSchema.safeParse(baseDraft);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.workflowStatus).toBe("draft");
  });

  it("rejects arbitrary executable tool identifiers", () => {
    const result = portableDraftSchema.safeParse({
      ...baseDraft,
      blocks: [{ type: "tool", toolKey: "custom-javascript", heading: "Unsafe" }]
    });
    expect(result.success).toBe(false);
  });

  it("requires a tool block for a tool-oriented template", () => {
    const result = portableDraftSchema.safeParse({
      ...baseDraft,
      blocks: [{ type: "callout", body: "No tool here" }]
    });
    expect(result.success).toBe(false);
  });

  it("caps a batch at one hundred documents", () => {
    const result = batchImportSchema.safeParse({
      items: Array.from({ length: 101 }, (_, index) => ({
        ...baseDraft,
        slug: `tools/word-counter-${index}`
      }))
    });
    expect(result.success).toBe(false);
  });

  it("rejects page slugs that the public website routes elsewhere", () => {
    const result = portableDraftSchema.safeParse({
      ...baseDraft,
      slug: "docs/generated-guide"
    });
    expect(result.success).toBe(false);
  });
});
