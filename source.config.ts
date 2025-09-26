import { defineDocs, frontmatterSchema } from "fumadocs-mdx/config";
import { z } from "zod";

const docsFrontmatterSchema = frontmatterSchema.extend({
  pricing: z.any().optional(),
});

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: docsFrontmatterSchema,
  },
});
