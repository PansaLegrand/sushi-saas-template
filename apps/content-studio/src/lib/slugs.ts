const slugSegment = /[^a-z0-9]+/g;
const reservedPageRoots = new Set(["api", "blogs", "docs", "privacy", "terms"]);

export function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split("/")
    .map((segment) =>
      segment
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(slugSegment, "-")
        .replace(/^-+|-+$/g, "")
    )
    .filter(Boolean)
    .join("/");
}

export function isValidSlug(value: unknown): true | string {
  if (typeof value !== "string" || value.length === 0) return "A slug is required.";
  if (value.length > 160) return "The slug must be 160 characters or fewer.";
  if (value !== normalizeSlug(value)) {
    return "Use lowercase letters, numbers, dashes, and forward slashes only.";
  }
  return true;
}

export function isReservedPageSlug(value: string): boolean {
  return reservedPageRoots.has(value.split("/")[0] ?? "");
}

export function isValidPageSlug(value: unknown): true | string {
  const valid = isValidSlug(value);
  if (valid !== true) return valid;
  if (isReservedPageSlug(value as string)) {
    return "This path is reserved by the public website. Choose another page path.";
  }
  return true;
}
