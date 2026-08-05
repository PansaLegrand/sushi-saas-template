const SITE_ORIGIN = "https://content.invalid";

export function safeSitePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.includes("\\")) return null;

  try {
    const url = new URL(candidate, SITE_ORIGIN);
    if (url.origin !== SITE_ORIGIN) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function safePublicHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate) return null;
  if (candidate.startsWith("#")) return candidate;

  const sitePath = safeSitePath(candidate);
  if (sitePath) return sitePath;

  try {
    const url = new URL(candidate);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}
