import type { Field } from "payload";
import { safeSitePath } from "@/lib/public-urls";

export const seoFields: Field = {
  name: "seo",
  type: "group",
  label: "Search and sharing",
  admin: {
    description:
      "Search guidance is advisory. Only malformed URLs and missing required page fields block publishing."
  },
  fields: [
    {
      type: "row",
      fields: [
        {
          name: "title",
          type: "text",
          localized: true,
          maxLength: 70,
          admin: { width: "50%" }
        },
        {
          name: "description",
          type: "textarea",
          localized: true,
          maxLength: 180,
          admin: { width: "50%" }
        }
      ]
    },
    {
      type: "row",
      fields: [
        {
          name: "primaryQuery",
          type: "text",
          localized: true,
          admin: { width: "50%" }
        },
        {
          name: "intent",
          type: "select",
          localized: true,
          options: [
            { label: "Informational", value: "informational" },
            { label: "Commercial", value: "commercial" },
            { label: "Transactional", value: "transactional" },
            { label: "Navigational", value: "navigational" }
          ],
          admin: { width: "50%" }
        }
      ]
    },
    {
      name: "secondaryQueries",
      type: "array",
      localized: true,
      fields: [{ name: "query", type: "text", required: true }]
    },
    {
      type: "row",
      fields: [
        {
          name: "canonicalPath",
          type: "text",
          admin: {
            description: "Optional site-relative override, for example /guides/example.",
            width: "50%"
          },
          validate(value: unknown) {
            if (!value) return true;
            return safeSitePath(value)
              ? true
              : "Canonical paths must be site-relative and start with /.";
          }
        },
        {
          name: "schemaType",
          type: "select",
          defaultValue: "WebPage",
          options: ["WebPage", "Article", "HowTo", "FAQPage", "SoftwareApplication"],
          admin: { width: "35%" }
        },
        {
          name: "noIndex",
          type: "checkbox",
          defaultValue: false,
          admin: { width: "15%" }
        }
      ]
    },
    {
      name: "openGraphImage",
      type: "upload",
      relationTo: "media"
    }
  ]
};
