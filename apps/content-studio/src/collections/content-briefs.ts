import type { CollectionConfig } from "payload";
import { contentEditors, publishersAndAdmins } from "@/lib/authz";

export const ContentBriefs: CollectionConfig = {
  slug: "content-briefs",
  labels: { singular: "Content brief", plural: "Content briefs" },
  admin: {
    group: "Planning",
    useAsTitle: "title",
    defaultColumns: ["title", "primaryKeyword", "status", "updatedAt"]
  },
  access: {
    create: contentEditors,
    read: contentEditors,
    update: contentEditors,
    delete: publishersAndAdmins
  },
  fields: [
    { name: "title", type: "text", required: true },
    {
      type: "row",
      fields: [
        { name: "locale", type: "select", required: true, options: ["en", "zh", "es", "fr", "ja"] },
        {
          name: "status",
          type: "select",
          defaultValue: "idea",
          required: true,
          options: ["idea", "researched", "ready", "used", "archived"]
        }
      ]
    },
    { name: "primaryKeyword", type: "text", required: true, index: true },
    {
      name: "secondaryKeywords",
      type: "array",
      fields: [{ name: "keyword", type: "text", required: true }]
    },
    {
      name: "intent",
      type: "select",
      options: ["informational", "commercial", "transactional", "navigational"]
    },
    { name: "audience", type: "textarea" },
    { name: "outline", type: "textarea", required: true },
    { name: "internalLinkTargets", type: "textarea" },
    { name: "workflowRunId", type: "text", index: true },
    { name: "sourceData", type: "json" }
  ]
};
