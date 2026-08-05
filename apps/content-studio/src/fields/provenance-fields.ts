import type { Field } from "payload";

export const provenanceFields: Field = {
  name: "provenance",
  type: "group",
  label: "Automation provenance",
  admin: {
    condition: (_, siblingData) => siblingData?.source !== "human",
    description: "Recorded automatically for API- and workflow-created content."
  },
  fields: [
    {
      name: "source",
      type: "select",
      defaultValue: "human",
      required: true,
      options: ["human", "api", "batch-import", "ai-workflow"]
    },
    { name: "workflowRunId", type: "text", index: true },
    { name: "model", type: "text" },
    { name: "promptVersion", type: "text" },
    {
      name: "sourceKeywords",
      type: "array",
      fields: [{ name: "keyword", type: "text", required: true }]
    },
    { name: "generatedAt", type: "date" },
    { name: "lastHumanEditAt", type: "date" }
  ]
};
