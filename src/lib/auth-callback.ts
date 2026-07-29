/**
 * Authentication callbacks originate in a browser query string, so they stay
 * untrusted even when one of our own links generated them.
 *
 * Canonicalizing through a fixed origin accepts same-site paths (including
 * query strings and hashes) while rejecting absolute, protocol-relative, and
 * backslash-based cross-origin destinations.
 */
export function safeAuthCallbackPath(
  value: string | null | undefined,
): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;

  try {
    const base = new URL("https://callback.invalid");
    const target = new URL(value, base);
    if (target.origin !== base.origin) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}
