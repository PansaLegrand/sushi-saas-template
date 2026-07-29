/**
 * Public transport names for the workspace selected in a browser tab.
 *
 * The query parameter makes account URLs shareable and tab-local. Browser API
 * calls mirror it into the header because API paths do not inherit a page's
 * query string. Neither value is trusted on its own: `services/authz` always
 * proves that the signed-in user belongs to the named organization.
 */
export const ORGANIZATION_QUERY_PARAM = "org";
export const ORGANIZATION_HEADER = "x-organization-slug";
export const ORGANIZATION_CONTEXT_MODE_HEADER = "x-organization-context-mode";

/**
 * Keep malformed or hostile header values away from authorization queries.
 *
 * Better Auth permits application-defined slugs, so this intentionally accepts
 * more than the starter's generated `[a-z0-9-]` format. It only rejects values
 * that cannot safely be carried in a URL/header and enforces the database
 * column's maximum length.
 */
export function normalizeOrganizationSlug(
  value: string | null | undefined
): string | null {
  const slug = value?.trim();
  if (!slug || slug.length > 255 || /[\u0000-\u001f\u007f]/.test(slug)) {
    return null;
  }

  return slug;
}
