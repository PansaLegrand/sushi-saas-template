import {
  ORGANIZATION_HEADER,
  ORGANIZATION_QUERY_PARAM,
  normalizeOrganizationSlug,
} from "@/config/organization-context";

/**
 * Mirror this tab's explicit workspace selection onto an API request.
 *
 * Reading the page URL at call time is intentional: module state or a cookie is
 * shared more broadly than the tab and recreates the cross-tab tenant race this
 * mechanism exists to remove.
 */
export function organizationHeaders(
  headers: Record<string, string> = {}
): Record<string, string> {
  if (typeof window === "undefined") return headers;

  const slug = normalizeOrganizationSlug(
    new URL(window.location.href).searchParams.get(ORGANIZATION_QUERY_PARAM)
  );

  return slug
    ? { [ORGANIZATION_HEADER]: slug, ...headers }
    : headers;
}
