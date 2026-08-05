type PreviewCollection = "pages" | "posts";

export function previewUrl(
  collection: PreviewCollection,
  data: Record<string, unknown>,
  locale?: string | { code?: string }
): string | null {
  if (!data.id) return null;
  const localeCode = typeof locale === "string" ? locale : locale?.code;
  const params = new URLSearchParams();
  if (localeCode) params.set("locale", localeCode);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return `/preview/${collection}/${encodeURIComponent(String(data.id))}${query}`;
}
