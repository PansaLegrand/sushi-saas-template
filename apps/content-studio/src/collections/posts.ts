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
import { isValidSlug } from "@/lib/slugs";

export const Posts: CollectionConfig = {
  slug: "posts",
  admin: {
    group: "Content",
    useAsTitle: "title",
    defaultColumns: ["title", "slug", "workflowStatus", "_status", "publishedAt"],
    preview: (data, { locale }) => previewUrl("posts", data, locale),
    livePreview: { url: ({ data, locale }) => previewUrl("posts", data, locale) }
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
    { name: "slug", type: "text", required: true, unique: true, index: true, validate: isValidSlug },
    { name: "summary", type: "textarea", localized: true, required: true, maxLength: 260 },
    {
      name: "authors",
      type: "array",
      localized: true,
      fields: [{ name: "name", type: "text", required: true }]
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
          label: "Article",
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
