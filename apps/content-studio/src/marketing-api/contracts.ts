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
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol));
const alignment = z.enum(["left", "center"]);

export const MarketingBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    text: z.string().trim().min(1).max(240),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    align: alignment
  }),
  z.object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(8000),
    align: alignment
  }),
  z.object({
    type: z.literal("image"),
    url: httpUrl,
    alt: z.string().trim().max(300),
    linkUrl: httpUrl.optional()
  }),
  z.object({
    type: z.literal("button"),
    label: z.string().trim().min(1).max(120),
    url: httpUrl,
    align: alignment
  }),
  z.object({ type: z.literal("divider") }),
  z.object({ type: z.literal("spacer"), size: z.enum(["small", "medium", "large"]) })
]);

export const MarketingMessageSchema = z.object({
  campaignKey: key,
  locale: z.enum(["en", "zh", "es", "fr", "ja"]),
  subject: z.string().trim().min(1).max(150).refine((value) => !/[\r\n]/.test(value)),
  preheader: z.string().trim().max(200),
  fromName: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((value) => !/[\r\n<>]/.test(value))
    .optional(),
  replyTo: z.email().max(320).optional(),
  template: z.object({
    logoUrl: httpUrl.optional(),
    accentColor: color,
    pageBackgroundColor: color,
    contentBackgroundColor: color,
    footerText: z.string().trim().max(1000),
    companyAddress: z.string().trim().min(1).max(500)
  }),
  blocks: z.array(MarketingBlockSchema).min(1).max(50)
});

export type MarketingMessage = z.infer<typeof MarketingMessageSchema>;
export type MarketingBlock = z.infer<typeof MarketingBlockSchema>;
