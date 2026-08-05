import type { Block } from "payload";

function validHttpUrl(value: unknown): true | string {
  if (typeof value !== "string") return "Enter a URL.";
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:"
      ? true
      : "Use an http or https URL.";
  } catch {
    return "Enter a valid URL.";
  }
}

export const EmailHeadingBlock: Block = {
  slug: "heading",
  interfaceName: "EmailHeadingBlock",
  labels: { singular: "Heading", plural: "Headings" },
  fields: [
    { name: "text", type: "text", required: true, maxLength: 240 },
    {
      type: "row",
      fields: [
        {
          name: "level",
          type: "select",
          required: true,
          defaultValue: "2",
          options: [
            { label: "Large", value: "1" },
            { label: "Medium", value: "2" },
            { label: "Small", value: "3" }
          ]
        },
        {
          name: "align",
          type: "select",
          required: true,
          defaultValue: "left",
          options: ["left", "center"]
        }
      ]
    }
  ]
};

export const EmailTextBlock: Block = {
  slug: "text",
  interfaceName: "EmailTextBlock",
  labels: { singular: "Text", plural: "Text sections" },
  fields: [
    {
      name: "text",
      type: "textarea",
      required: true,
      maxLength: 8000,
      admin: { description: "Plain text with line breaks. HTML is intentionally not accepted." }
    },
    {
      name: "align",
      type: "select",
      required: true,
      defaultValue: "left",
      options: ["left", "center"]
    }
  ]
};

export const EmailImageBlock: Block = {
  slug: "image",
  interfaceName: "EmailImageBlock",
  labels: { singular: "Image", plural: "Images" },
  fields: [
    { name: "url", type: "text", required: true, validate: validHttpUrl },
    { name: "alt", type: "text", maxLength: 300 },
    { name: "linkUrl", type: "text", validate: (value: unknown) => (value ? validHttpUrl(value) : true) }
  ]
};

export const EmailButtonBlock: Block = {
  slug: "button",
  interfaceName: "EmailButtonBlock",
  labels: { singular: "Button", plural: "Buttons" },
  fields: [
    {
      type: "row",
      fields: [
        { name: "label", type: "text", required: true, maxLength: 120 },
        { name: "url", type: "text", required: true, validate: validHttpUrl }
      ]
    },
    {
      name: "align",
      type: "select",
      required: true,
      defaultValue: "left",
      options: ["left", "center"]
    }
  ]
};

export const EmailDividerBlock: Block = {
  slug: "divider",
  interfaceName: "EmailDividerBlock",
  labels: { singular: "Divider", plural: "Dividers" },
  fields: []
};

export const EmailSpacerBlock: Block = {
  slug: "spacer",
  interfaceName: "EmailSpacerBlock",
  labels: { singular: "Spacer", plural: "Spacers" },
  fields: [
    {
      name: "size",
      type: "select",
      required: true,
      defaultValue: "medium",
      options: ["small", "medium", "large"]
    }
  ]
};

export const emailBlocks = [
  EmailHeadingBlock,
  EmailTextBlock,
  EmailImageBlock,
  EmailButtonBlock,
  EmailDividerBlock,
  EmailSpacerBlock
];
