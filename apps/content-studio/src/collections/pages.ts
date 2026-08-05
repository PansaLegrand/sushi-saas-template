import type { CollectionConfig } from "payload";
import { contentBlocks } from "@/blocks/content-blocks";
import { contentEditors, publishersAndAdmins, studioUsersOrPublished } from "@/lib/authz";
import { seoFields } from "@/fields/seo-fields";
import { provenanceFields } from "@/fields/provenance-fields";
import {
  prepareContent,
  revalidateContent,
  revalidateDeletedContent
} from "@/hooks/content-hooks";
import { previewUrl } from "@/lib/preview-url";
import { isValidPageSlug } from "@/lib/slugs";

export const Pages: CollectionConfig = {
  slug: "pages",
  admin: {
    group: "Content",
    useAsTitle: "title",
    defaultColumns: ["title", "slug", "template", "workflowStatus", "_status", "updatedAt"],
    preview: (data, { locale }) => previewUrl("pages", data, locale),
    livePreview: { url: ({ data, locale }) => previewUrl("pages", data, locale) }
  },
  access: {
    create: contentEditors,
    read: studioUsersOrPublished,
    update: contentEditors,
    delete: publishersAndAdmins
  },
  hooks: {
    beforeChange: [prepareContent],
    afterChange: [revalidateContent],
    afterDelete: [revalidateDeletedContent]
  },
  fields: [
    { name: "title", type: "text", localized: true, required: true },
    {
      name: "slug",
      type: "text",
      required: true,
      unique: true,
      index: true,
      validate: isValidPageSlug,
      admin: { description: "Path without a leading slash, for example tools/word-counter." }
    },
    {
      name: "summary",
      type: "textarea",
      localized: true,
      required: true,
      maxLength: 260
    },
    {
      name: "template",
      type: "select",
      required: true,
      defaultValue: "content",
      options: [
        { label: "Content", value: "content" },
        { label: "Landing page", value: "landing" },
        { label: "Content with tool", value: "content-with-tool" },
        { label: "Tool first", value: "tool-first" }
      ],
      admin: { position: "sidebar" }
    },
    {
      name: "workflowStatus",
      type: "select",
      required: true,
      defaultValue: "draft",
      options: ["draft", "in-review", "approved", "archived"],
      admin: { position: "sidebar" }
    },
    { name: "publishedAt", type: "date", admin: { position: "sidebar", readOnly: true } },
    {
      type: "tabs",
      tabs: [
        {
          label: "Page",
          fields: [
            {
              name: "layout",
              type: "blocks",
              localized: true,
              blocks: contentBlocks,
              admin: { initCollapsed: true }
            }
          ]
        },
        { label: "SEO", fields: [seoFields] },
        { label: "Automation", fields: [provenanceFields] }
      ]
    }
  ],
  versions: {
    drafts: {
      autosave: { interval: 800 },
      schedulePublish: true,
      validate: false,
      localizeStatus: true
    },
    maxPerDoc: 50
  }
};
