import { convertMarkdownToLexical } from "@payloadcms/richtext-lexical";
import type { PortableDraft } from "@/content-api/schemas";

type EditorConfig = Parameters<typeof convertMarkdownToLexical>[0]["editorConfig"];

export function toPayloadDraft(
  input: PortableDraft,
  config: { editor?: unknown }
): Record<string, unknown> {
  const layout = input.blocks.map((block) => {
    if (block.type === "richText") {
      return {
        blockType: "richText",
        content: convertMarkdownToLexical({
          editorConfig: config.editor as unknown as EditorConfig,
          markdown: block.markdown
        })
      };
    }

    const values: Record<string, unknown> = { ...block };
    delete values.type;
    return { blockType: block.type, ...values };
  });

  const base = {
    title: input.title,
    slug: input.slug,
    summary: input.summary,
    workflowStatus: input.workflowStatus,
    layout,
    seo: {
      ...input.seo,
      secondaryQueries: input.seo.secondaryQueries.map((query) => ({ query }))
    },
    provenance: {
      ...input.provenance,
      sourceKeywords: input.provenance.sourceKeywords.map((keyword) => ({ keyword })),
      generatedAt: new Date().toISOString()
    }
  };

  if (input.collection === "posts") {
    return { ...base, authors: input.authors.map((name) => ({ name })) };
  }

  return { ...base, template: input.template };
}

export function serializePublishedDocument(
  collection: "pages" | "posts",
  document: Record<string, unknown>
): Record<string, unknown> {
  return {
    id: document.id,
    collection,
    title: document.title,
    slug: document.slug,
    summary: document.summary,
    template: document.template,
    authors: document.authors,
    layout: document.layout,
    seo: document.seo,
    publishedAt: document.publishedAt,
    updatedAt: document.updatedAt
  };
}

export function serializeDraftDocument(
  collection: "pages" | "posts",
  document: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...serializePublishedDocument(collection, document),
    status: document._status,
    workflowStatus: document.workflowStatus,
    provenance: document.provenance
  };
}
