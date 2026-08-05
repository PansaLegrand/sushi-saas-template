import type { TaskConfig } from "payload";
import { batchImportSchema } from "@/content-api/schemas";
import { toPayloadDraft } from "@/content-api/transform";

export const importContentTask = {
  slug: "importContent",
  retries: 2,
  inputSchema: [
    { name: "items", type: "json", required: true },
    { name: "identity", type: "text", required: true }
  ],
  outputSchema: [{ name: "results", type: "json", required: true }],
  handler: async ({ input, req }) => {
    const parsed = batchImportSchema.safeParse({ items: input?.items });
    if (!parsed.success) {
      return {
        state: "failed",
        output: { results: [{ ok: false, error: "The stored batch input is invalid." }] }
      };
    }

    const results: Array<Record<string, unknown>> = [];
    for (const item of parsed.data.items) {
      try {
        const document = await req.payload.create({
          collection: item.collection,
          data: toPayloadDraft(item, req.payload.config),
          draft: true,
          locale: item.locale,
          overrideAccess: true,
          req
        });
        results.push({ ok: true, collection: item.collection, id: document.id, slug: item.slug });
      } catch (error) {
        req.payload.logger.error({ err: error, slug: item.slug }, "Content batch item failed");
        results.push({ ok: false, collection: item.collection, slug: item.slug, error: "CREATE_FAILED" });
      }
    }

    return { output: { results } };
  }
} as TaskConfig<"importContent">;
