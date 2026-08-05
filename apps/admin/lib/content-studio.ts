/**
 * Resolve this repository's separately deployed publishing workspace without exposing the
 * value as a NEXT_PUBLIC variable. The URL is passed from the server layout to
 * the client shell only when it is safe to render as an external link.
 */
export function parseContentStudioUrl(
  value: string | undefined,
): string | undefined {
  const candidate = value?.trim();
  if (!candidate) return undefined;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    return url.toString();
  } catch {
    return undefined;
  }
}

export function getContentStudioUrl(): string | undefined {
  return parseContentStudioUrl(process.env.CONTENT_STUDIO_URL);
}
