import type { CollectionConfig } from "payload";
import {
  publishersAndAdmins,
  studioUsersOrAutomation
} from "@/lib/authz";
import { prepareMarketingTemplate } from "@/hooks/marketing-hooks";

const hexColor = (value: unknown) =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? true
    : "Use a six-digit hex color such as #15856f.";

const httpUrl = (value: unknown) => {
  if (!value) return true;
  try {
    const protocol = new URL(String(value)).protocol;
    return protocol === "http:" || protocol === "https:"
      ? true
      : "Use an http or https URL.";
  } catch {
    return "Enter a valid URL.";
  }
};

export const MarketingEmailTemplates: CollectionConfig = {
  slug: "marketing-email-templates",
  labels: { singular: "Email template", plural: "Email templates" },
  admin: {
    group: "Marketing",
    useAsTitle: "name",
    defaultColumns: ["name", "key", "updatedAt"]
  },
  access: {
    create: studioUsersOrAutomation("marketing:draft:create"),
    read: studioUsersOrAutomation("marketing:read"),
    update: studioUsersOrAutomation("marketing:draft:update"),
    delete: publishersAndAdmins
  },
  hooks: { beforeChange: [prepareMarketingTemplate] },
  fields: [
    { name: "name", type: "text", required: true },
    {
      name: "key",
      type: "text",
      required: true,
      unique: true,
      index: true,
      validate: (value: unknown) =>
        typeof value === "string" && /^[a-z0-9][a-z0-9._:-]*$/.test(value)
          ? true
          : "Use lowercase letters, numbers, dots, underscores, colons, or hyphens."
    },
    {
      type: "tabs",
      tabs: [
        {
          label: "Brand",
          fields: [
            { name: "logoUrl", type: "text", validate: httpUrl },
            {
              type: "row",
              fields: [
                {
                  name: "accentColor",
                  type: "text",
                  required: true,
                  defaultValue: "#15856f",
                  validate: hexColor
                },
                {
                  name: "pageBackgroundColor",
                  type: "text",
                  required: true,
                  defaultValue: "#f4f3ee",
                  validate: hexColor
                },
                {
                  name: "contentBackgroundColor",
                  type: "text",
                  required: true,
                  defaultValue: "#ffffff",
                  validate: hexColor
                }
              ]
            }
          ]
        },
        {
          label: "Sender",
          fields: [
            {
              type: "row",
              fields: [
                { name: "defaultFromName", type: "text", maxLength: 100 },
                { name: "defaultReplyTo", type: "email" }
              ]
            }
          ]
        },
        {
          label: "Compliance footer",
          fields: [
            { name: "footerText", type: "textarea", localized: true, maxLength: 1000 },
            {
              name: "companyAddress",
              type: "textarea",
              required: true,
              maxLength: 500,
              admin: {
                description:
                  "A valid sender postal address. The SaaS adds this and its unsubscribe link to every marketing message."
              }
            }
          ]
        }
      ]
    }
  ],
  versions: { drafts: { autosave: { interval: 800 } }, maxPerDoc: 30 }
};
