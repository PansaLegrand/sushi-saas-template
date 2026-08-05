import { describe, expect, it } from "vitest";
import { publishingIssue } from "@/lib/publishing";

describe("publish validation", () => {
  it("requires review approval and meaningful page content", () => {
    expect(publishingIssue({ workflowStatus: "draft", layout: [{ blockType: "richText" }] })).toMatch(
      /Approve/
    );
    expect(publishingIssue({ workflowStatus: "approved", layout: [] })).toMatch(/content block/);
  });

  it("requires a registered tool on tool-oriented pages", () => {
    expect(
      publishingIssue({
        workflowStatus: "approved",
        template: "content-with-tool",
        layout: [{ blockType: "richText" }]
      })
    ).toMatch(/interactive tool/);
    expect(
      publishingIssue({
        workflowStatus: "approved",
        template: "tool-first",
        layout: [{ blockType: "tool" }]
      })
    ).toBeNull();
  });
});
