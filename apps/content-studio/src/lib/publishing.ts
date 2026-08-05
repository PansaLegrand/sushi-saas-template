type PublishableDocument = {
  layout?: Array<{ blockType?: string }> | null;
  template?: string | null;
  workflowStatus?: string | null;
};

export function publishingIssue(document: PublishableDocument): string | null {
  if (document.workflowStatus !== "approved") {
    return "Approve this content before publishing it.";
  }
  if (!document.layout?.length) {
    return "Add at least one content block before publishing.";
  }
  if (
    (document.template === "content-with-tool" || document.template === "tool-first") &&
    !document.layout.some((block) => block.blockType === "tool")
  ) {
    return "Tool-oriented pages must contain a registered interactive tool block.";
  }
  return null;
}
