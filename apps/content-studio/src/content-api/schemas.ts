import { z } from "zod";
import { safePublicHref, safeSitePath } from "@/lib/public-urls";
import { isReservedPageSlug } from "@/lib/slugs";

export const contentLocales = ["en", "zh", "es", "fr", "ja"] as const;
export const toolKeys = ["word-counter", "percentage-calculator", "keyword-density"] as const;

const heroBlock = z.object({
  type: z.literal("hero"),
  eyebrow: z.string().max(120).optional(),
  heading: z.string().min(1).max(180),
  lede: z.string().max(600).optional(),
  alignment: z.enum(["left", "center"]).default("left")
});

const richTextBlock = z.object({
  type: z.literal("richText"),
  markdown: z.string().min(1).max(100_000)
});

const calloutBlock = z.object({
  type: z.literal("callout"),
  heading: z.string().max(180).optional(),
  body: z.string().min(1).max(4000),
  tone: z.enum(["note", "tip", "warning"]).default("note")
});

const faqBlock = z.object({
  type: z.literal("faq"),
  heading: z.string().max(180).optional(),
  items: z
    .array(
      z.object({
        question: z.string().min(1).max(300),
        answer: z.string().min(1).max(5000)
      })
    )
    .min(1)
    .max(50)
});

const ctaBlock = z.object({
  type: z.literal("cta"),
  heading: z.string().min(1).max(180),
  body: z.string().max(1000).optional(),
  label: z.string().min(1).max(80),
  href: z
    .string()
    .min(1)
    .max(500)
    .transform((value, context) => {
      const safe = safePublicHref(value);
      if (safe) return safe;
      context.addIssue({ code: "custom", message: "Enter a safe CTA destination." });
      return z.NEVER;
    }),
  style: z.enum(["primary", "secondary"]).default("primary")
});

const toolBlock = z.object({
  type: z.literal("tool"),
  toolKey: z.enum(toolKeys),
  heading: z.string().min(1).max(180),
  description: z.string().max(1000).optional(),
  placement: z.enum(["inline", "wide", "sticky-aside"]).default("inline"),
  theme: z.enum(["card", "quiet", "accent"]).default("card"),
  config: z
    .object({
      inputLabel: z.string().max(120).optional(),
      defaultKeyword: z.string().max(120).optional()
    })
    .default({})
});

export const portableBlockSchema = z.discriminatedUnion("type", [
  heroBlock,
  richTextBlock,
  calloutBlock,
  faqBlock,
  ctaBlock,
  toolBlock
]);

const provenanceSchema = z
  .object({
    source: z.enum(["api", "batch-import", "ai-workflow"]).default("api"),
    workflowRunId: z.string().max(200).optional(),
    model: z.string().max(200).optional(),
    promptVersion: z.string().max(200).optional(),
    sourceKeywords: z.array(z.string().min(1).max(200)).max(200).default([])
  })
  .default({ source: "api", sourceKeywords: [] });

const seoSchema = z
  .object({
    title: z.string().max(70).optional(),
    description: z.string().max(180).optional(),
    primaryQuery: z.string().max(200).optional(),
    secondaryQueries: z.array(z.string().min(1).max(200)).max(100).default([]),
    intent: z.enum(["informational", "commercial", "transactional", "navigational"]).optional(),
    canonicalPath: z
      .string()
      .max(500)
      .transform((value, context) => {
        const safe = safeSitePath(value);
        if (safe) return safe;
        context.addIssue({ code: "custom", message: "Use a site-relative canonical path." });
        return z.NEVER;
      })
      .optional(),
    schemaType: z
      .enum(["WebPage", "Article", "HowTo", "FAQPage", "SoftwareApplication"])
      .default("WebPage"),
    noIndex: z.boolean().default(false)
  })
  .default({ secondaryQueries: [], schemaType: "WebPage", noIndex: false });

export const portableDraftSchema = z
  .object({
    collection: z.enum(["pages", "posts"]),
    locale: z.enum(contentLocales).default("en"),
    slug: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/, "Use a normalized lowercase slug."),
    title: z.string().min(1).max(220),
    summary: z.string().min(1).max(260),
    template: z.enum(["content", "landing", "content-with-tool", "tool-first"]).default("content"),
    authors: z.array(z.string().min(1).max(120)).max(20).default([]),
    workflowStatus: z.enum(["draft", "in-review"]).default("draft"),
    blocks: z.array(portableBlockSchema).min(1).max(100),
    seo: seoSchema,
    provenance: provenanceSchema
  })
  .superRefine((data, context) => {
    if (data.collection === "pages" && isReservedPageSlug(data.slug)) {
      context.addIssue({
        code: "custom",
        path: ["slug"],
        message: "This path is reserved by the public website."
      });
    }
    const containsTool = data.blocks.some((block) => block.type === "tool");
    if ((data.template === "content-with-tool" || data.template === "tool-first") && !containsTool) {
      context.addIssue({
        code: "custom",
        path: ["blocks"],
        message: "Tool-oriented templates must contain a registered tool block."
      });
    }
  });

export const batchImportSchema = z.object({
  items: z.array(portableDraftSchema).min(1).max(100)
});

export const workflowTransitionSchema = z.object({
  locale: z.enum(contentLocales).default("en")
});

export const contentBriefSchema = z.object({
  title: z.string().min(1).max(220),
  locale: z.enum(contentLocales).default("en"),
  primaryKeyword: z.string().min(1).max(200),
  secondaryKeywords: z.array(z.string().min(1).max(200)).max(200).default([]),
  intent: z.enum(["informational", "commercial", "transactional", "navigational"]).optional(),
  audience: z.string().max(2000).optional(),
  outline: z.string().min(1).max(30_000),
  internalLinkTargets: z.string().max(10_000).optional(),
  workflowRunId: z.string().max(200).optional(),
  sourceData: z.json().optional()
});

export type PortableDraft = z.infer<typeof portableDraftSchema>;
