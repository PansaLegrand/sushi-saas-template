import type { Block } from "payload";
import { safePublicHref } from "@/lib/public-urls";

export const HeroBlock: Block = {
  slug: "hero",
  interfaceName: "HeroBlock",
  labels: { singular: "Hero", plural: "Heroes" },
  fields: [
    { name: "eyebrow", type: "text" },
    { name: "heading", type: "text", required: true },
    { name: "lede", type: "textarea" },
    {
      name: "alignment",
      type: "select",
      defaultValue: "left",
      options: ["left", "center"]
    }
  ]
};

export const RichTextBlock: Block = {
  slug: "richText",
  interfaceName: "RichTextBlock",
  labels: { singular: "Rich text", plural: "Rich text sections" },
  fields: [{ name: "content", type: "richText", required: true }]
};

export const CalloutBlock: Block = {
  slug: "callout",
  interfaceName: "CalloutBlock",
  fields: [
    { name: "heading", type: "text" },
    { name: "body", type: "textarea", required: true },
    {
      name: "tone",
      type: "select",
      defaultValue: "note",
      options: ["note", "tip", "warning"]
    }
  ]
};

export const FaqBlock: Block = {
  slug: "faq",
  interfaceName: "FaqBlock",
  fields: [
    { name: "heading", type: "text", defaultValue: "Frequently asked questions" },
    {
      name: "items",
      type: "array",
      minRows: 1,
      fields: [
        { name: "question", type: "text", required: true },
        { name: "answer", type: "textarea", required: true }
      ]
    }
  ]
};

export const CtaBlock: Block = {
  slug: "cta",
  interfaceName: "CtaBlock",
  labels: { singular: "Call to action", plural: "Calls to action" },
  fields: [
    { name: "heading", type: "text", required: true },
    { name: "body", type: "textarea" },
    {
      type: "row",
      fields: [
        { name: "label", type: "text", required: true, admin: { width: "40%" } },
        {
          name: "href",
          type: "text",
          required: true,
          admin: {
            description: "Use a site path, https URL, email link, or page anchor.",
            width: "60%"
          },
          validate: (value: unknown) =>
            safePublicHref(value) ? true : "Enter a safe path, URL, email link, or anchor."
        }
      ]
    },
    {
      name: "style",
      type: "select",
      defaultValue: "primary",
      options: ["primary", "secondary"]
    }
  ]
};

export const ToolBlock: Block = {
  slug: "tool",
  interfaceName: "ToolBlock",
  labels: { singular: "Interactive tool", plural: "Interactive tools" },
  fields: [
    {
      name: "toolKey",
      type: "select",
      required: true,
      admin: {
        description:
          "Only developer-registered tools can run on public pages; arbitrary scripts are never accepted."
      },
      options: [
        { label: "Word and character counter", value: "word-counter" },
        { label: "Percentage calculator", value: "percentage-calculator" },
        { label: "Keyword density checker", value: "keyword-density" }
      ]
    },
    { name: "heading", type: "text", required: true },
    { name: "description", type: "textarea" },
    {
      type: "row",
      fields: [
        {
          name: "placement",
          type: "select",
          defaultValue: "inline",
          options: ["inline", "wide", "sticky-aside"],
          admin: { width: "50%" }
        },
        {
          name: "theme",
          type: "select",
          defaultValue: "card",
          options: ["card", "quiet", "accent"],
          admin: { width: "50%" }
        }
      ]
    },
    {
      name: "config",
      type: "group",
      fields: [
        { name: "inputLabel", type: "text" },
        { name: "defaultKeyword", type: "text" }
      ]
    }
  ]
};

export const contentBlocks = [
  HeroBlock,
  RichTextBlock,
  CalloutBlock,
  FaqBlock,
  CtaBlock,
  ToolBlock
];
