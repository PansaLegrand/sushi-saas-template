import type { CollectionConfig } from "payload";
import { emailBlocks } from "@/blocks/email-blocks";
import {
  publishersAndAdmins,
  studioUsersOrAutomation
} from "@/lib/authz";
import { prepareMarketingCampaign } from "@/hooks/marketing-hooks";

function campaignPreviewUrl(data: Record<string, unknown>): string {
  const base = process.env.CONTENT_STUDIO_URL ?? "http://localhost:3002";
  return data.id
    ? new URL(`/api/marketing/v1/campaigns/${String(data.id)}/preview`, base).toString()
    : base;
}

export const MarketingCampaigns: CollectionConfig = {
  slug: "marketing-campaigns",
  labels: { singular: "Email campaign", plural: "Email campaigns" },
  admin: {
    group: "Marketing",
    useAsTitle: "internalName",
    defaultColumns: [
      "internalName",
      "campaignKey",
      "locale",
      "workflowStatus",
      "launchStatus",
      "scheduledAt"
    ],
    preview: (data) => campaignPreviewUrl(data),
    livePreview: { url: ({ data }) => campaignPreviewUrl(data) }
  },
  access: {
    create: studioUsersOrAutomation("marketing:draft:create"),
    read: studioUsersOrAutomation("marketing:read"),
    update: studioUsersOrAutomation("marketing:draft:update"),
    delete: publishersAndAdmins
  },
  hooks: { beforeChange: [prepareMarketingCampaign] },
  fields: [
    { name: "internalName", type: "text", required: true },
    {
      name: "campaignKey",
      type: "text",
      required: true,
      unique: true,
      index: true,
      admin: { description: "Stable launch identity, for example 2026-08-product-update." },
      validate: (value: unknown) =>
        typeof value === "string" && /^[a-z0-9][a-z0-9._:-]*$/.test(value)
          ? true
          : "Use lowercase letters, numbers, dots, underscores, colons, or hyphens."
    },
    {
      type: "row",
      fields: [
        {
          name: "locale",
          type: "select",
          required: true,
          defaultValue: "en",
          options: ["en", "zh", "es", "fr", "ja"]
        },
        {
          name: "audienceTopic",
          type: "text",
          required: true,
          defaultValue: "product-updates",
          admin: {
            description: "A consent topic resolved by the SaaS; recipient addresses never enter the Studio."
          },
          validate: (value: unknown) =>
            typeof value === "string" && /^[a-z0-9][a-z0-9._:-]*$/.test(value)
              ? true
              : "Use a lowercase topic key."
        },
        {
          name: "filterAudienceByLocale",
          type: "checkbox",
          defaultValue: true,
          label: "Only subscribers in this locale"
        }
      ]
    },
    {
      name: "template",
      type: "relationship",
      relationTo: "marketing-email-templates",
      required: true
    },
    {
      type: "tabs",
      tabs: [
        {
          label: "Message",
          fields: [
            { name: "subject", type: "text", required: true, maxLength: 150 },
            { name: "preheader", type: "text", maxLength: 200 },
            {
              name: "content",
              type: "blocks",
              required: true,
              minRows: 1,
              maxRows: 50,
              blocks: emailBlocks,
              admin: { initCollapsed: false }
            }
          ]
        },
        {
          label: "Sender override",
          fields: [
            {
              type: "row",
              fields: [
                { name: "fromName", type: "text", maxLength: 100 },
                { name: "replyTo", type: "email" }
              ]
            }
          ]
        },
        {
          label: "Review & launch",
          fields: [
            {
              name: "workflowStatus",
              type: "select",
              required: true,
              defaultValue: "draft",
              options: ["draft", "in-review", "approved", "archived"]
            },
            {
              name: "scheduledAt",
              type: "date",
              admin: {
                date: { pickerAppearance: "dayAndTime" },
                description: "Optional. Launch queues the campaign now and the SaaS waits until this time."
              }
            },
            {
              type: "row",
              fields: [
                {
                  name: "launchStatus",
                  type: "select",
                  defaultValue: "not-launched",
                  options: [
                    "not-launched",
                    "scheduled",
                    "queued",
                    "completed",
                    "canceled",
                    "failed"
                  ],
                  admin: { readOnly: true }
                },
                { name: "launchedAt", type: "date", admin: { readOnly: true } },
                { name: "recipientCount", type: "number", admin: { readOnly: true } }
              ]
            },
            {
              name: "campaignActions",
              type: "ui",
              admin: { components: { Field: "@/components/campaign-actions" } }
            }
          ]
        }
      ]
    }
  ],
  versions: {
    drafts: { autosave: { interval: 800 }, validate: false },
    maxPerDoc: 50
  }
};
