// @ts-nocheck
// Fumadocs MDX source configuration
// This defines frontmatter fields available in content/docs/* MDX files.
import { defineDocs, frontmatterSchema } from "fumadocs-mdx/config/zod-3";
import { z } from "zod";

// Extend the default frontmatter to support SEO fields we want to surface
// in Next.js metadata (and keep the existing optional pricing field).
const docsFrontmatterSchema = frontmatterSchema.extend({
  // Keep existing extension
  pricing: z.any().optional(),

  // SEO additions
  keywords: z.union([z.array(z.string()), z.string()]).optional(),
  tags: z.union([z.array(z.string()), z.string()]).optional(),
  author: z.union([z.string(), z.array(z.string())]).optional(),
  authors: z.array(z.string()).optional(),
  publishedAt: z.string().optional(), // ISO string recommended
  updatedAt: z.string().optional(), // ISO string recommended
  image: z.string().optional(), // absolute or path under /public
  canonical: z.string().optional(), // absolute URL
  noindex: z.boolean().optional(),
});

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: docsFrontmatterSchema,
  },
});
