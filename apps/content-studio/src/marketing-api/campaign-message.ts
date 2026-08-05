import type { PayloadRequest } from "payload";
import {
  MarketingMessageSchema,
  type MarketingBlock,
  type MarketingMessage
} from "./contracts";

type Document = Record<string, unknown>;

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | undefined {
  const result = string(value);
  return result || undefined;
}

function blockFromDocument(value: unknown): MarketingBlock | null {
  if (!value || typeof value !== "object") return null;
  const block = value as Document;
  const type = string(block.blockType);
  if (type === "heading") {
    const rawLevel = Number(block.level);
    const level = rawLevel === 1 || rawLevel === 3 ? rawLevel : 2;
    return {
      type,
      text: string(block.text),
      level,
      align: block.align === "center" ? "center" : "left"
    };
  }
  if (type === "text") {
    return {
      type,
      text: string(block.text),
      align: block.align === "center" ? "center" : "left"
    };
  }
  if (type === "image") {
    return {
      type,
      url: string(block.url),
      alt: string(block.alt),
      ...(optionalString(block.linkUrl) ? { linkUrl: optionalString(block.linkUrl) } : {})
    };
  }
  if (type === "button") {
    return {
      type,
      label: string(block.label),
      url: string(block.url),
      align: block.align === "center" ? "center" : "left"
    };
  }
  if (type === "divider") return { type };
  if (type === "spacer") {
    const size = ["small", "medium", "large"].includes(string(block.size))
      ? (string(block.size) as "small" | "medium" | "large")
      : "medium";
    return { type, size };
  }
  return null;
}

async function resolveTemplate(
  req: PayloadRequest,
  campaign: Document,
  locale: string
): Promise<Document> {
  if (campaign.template && typeof campaign.template === "object") {
    return campaign.template as Document;
  }
  return (await req.payload.findByID({
    collection: "marketing-email-templates",
    id: String(campaign.template ?? ""),
    locale: locale as "en" | "zh" | "es" | "fr" | "ja",
    fallbackLocale: false,
    depth: 0,
    overrideAccess: true,
    req
  })) as unknown as Document;
}

export async function loadCampaignMessage(input: {
  req: PayloadRequest;
  id: string;
  draft: boolean;
}): Promise<{ campaign: Document; message: MarketingMessage }> {
  const campaign = (await input.req.payload.findByID({
    collection: "marketing-campaigns",
    id: input.id,
    draft: input.draft,
    depth: 2,
    overrideAccess: true,
    req: input.req
  })) as unknown as Document;
  const locale = string(campaign.locale) || "en";
  const template = await resolveTemplate(input.req, campaign, locale);
  const blocks = Array.isArray(campaign.content)
    ? campaign.content.map(blockFromDocument).filter((block): block is MarketingBlock => Boolean(block))
    : [];

  const message = MarketingMessageSchema.parse({
    campaignKey: campaign.campaignKey,
    locale,
    subject: campaign.subject,
    preheader: string(campaign.preheader),
    fromName: optionalString(campaign.fromName) ?? optionalString(template.defaultFromName),
    replyTo: optionalString(campaign.replyTo) ?? optionalString(template.defaultReplyTo),
    template: {
      logoUrl: optionalString(template.logoUrl),
      accentColor: string(template.accentColor) || "#15856f",
      pageBackgroundColor: string(template.pageBackgroundColor) || "#f4f3ee",
      contentBackgroundColor: string(template.contentBackgroundColor) || "#ffffff",
      footerText: string(template.footerText),
      companyAddress: template.companyAddress
    },
    blocks
  });

  return { campaign, message };
}
