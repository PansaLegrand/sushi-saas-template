import { z } from "zod";

const key = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const httpUrl = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Only http and https URLs are allowed.");
const alignment = z.enum(["left", "center"]);

export const MarketingBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    text: z.string().trim().min(1).max(240),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    align: alignment.default("left"),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(8_000),
    align: alignment.default("left"),
  }),
  z.object({
    type: z.literal("image"),
    url: httpUrl,
    alt: z.string().trim().max(300).default(""),
    linkUrl: httpUrl.optional(),
  }),
  z.object({
    type: z.literal("button"),
    label: z.string().trim().min(1).max(120),
    url: httpUrl,
    align: alignment.default("left"),
  }),
  z.object({ type: z.literal("divider") }),
  z.object({
    type: z.literal("spacer"),
    size: z.enum(["small", "medium", "large"]).default("medium"),
  }),
]);

export const MarketingMessageSchema = z.object({
  campaignKey: key,
  locale: z.enum(["en", "zh", "es", "fr", "ja"]),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .refine((value) => !/[\r\n]/.test(value)),
  preheader: z.string().trim().max(200).default(""),
  fromName: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => !/[\r\n<>]/.test(value))
    .optional(),
  replyTo: z.string().trim().email().max(320).optional(),
  template: z.object({
    logoUrl: httpUrl.optional(),
    accentColor: color.default("#15856f"),
    pageBackgroundColor: color.default("#f4f3ee"),
    contentBackgroundColor: color.default("#ffffff"),
    footerText: z.string().trim().max(1_000).default(""),
    companyAddress: z.string().trim().min(1).max(500),
  }),
  blocks: z.array(MarketingBlockSchema).min(1).max(50),
});

export const MarketingTestRequestSchema = z.object({
  requestId: key,
  recipient: z.string().trim().email().max(320),
  message: MarketingMessageSchema,
});

export const MarketingAudienceSchema = z.object({
  topic: key.max(64),
  locale: z.enum(["en", "zh", "es", "fr", "ja"]).optional(),
});

export const MarketingDispatchRequestSchema = z.object({
  requestId: key,
  message: MarketingMessageSchema,
  audience: MarketingAudienceSchema,
  scheduleAt: z.string().datetime({ offset: true }).optional(),
});

export const MarketingAudienceRequestSchema = z.object({
  requestId: key,
  audience: MarketingAudienceSchema,
});

export const MarketingCampaignActionRequestSchema = z.object({
  requestId: key,
  campaignKey: key,
});

export const MarketingSubscriptionRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  topic: key.max(64).default("product-updates"),
  locale: z.enum(["en", "zh", "es", "fr", "ja"]).default("en"),
  consent: z.literal(true),
  consentSource: key.max(128),
  consentVersion: key.max(64),
});

export type MarketingBlock = z.infer<typeof MarketingBlockSchema>;
export type MarketingMessage = z.infer<typeof MarketingMessageSchema>;
export type MarketingTestRequest = z.infer<typeof MarketingTestRequestSchema>;
export type MarketingDispatchRequest = z.infer<
  typeof MarketingDispatchRequestSchema
>;
export type MarketingAudienceRequest = z.infer<
  typeof MarketingAudienceRequestSchema
>;
export type MarketingCampaignActionRequest = z.infer<
  typeof MarketingCampaignActionRequestSchema
>;
export type MarketingSubscriptionRequest = z.infer<
  typeof MarketingSubscriptionRequestSchema
>;
