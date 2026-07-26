import { randomUUID } from "node:crypto";

import {
  findMembershipsByUserId,
  markOrganizationPersonal,
  type OrganizationRow,
} from "@/models/organization";

/**
 * Tenancy, from the application's side.
 *
 * The rule this file exists to uphold: **every user belongs to at least one
 * organization, always**. Signup mints a personal org, so a solo account is a
 * team of one rather than a second, user-owned code path running alongside the
 * org-owned one. That is what keeps tenancy from doubling every query, every
 * permission check, and every billing rule — there is nothing to branch on.
 */

/** Derive a display name that is not an email address and not English. */
function personalOrgName(user: { email?: string | null; nickname?: string | null }) {
  const nickname = user.nickname?.trim();
  if (nickname) return nickname.slice(0, 255);

  const local = user.email?.split("@")[0]?.trim();
  return (local || "workspace").slice(0, 255);
}

/**
 * Slugs are unique across every tenant, so a readable stem alone will collide
 * the second time anyone named "alex" signs up. The random suffix makes the
 * insert safe without a retry loop; the stem keeps the slug recognizable.
 */
function personalOrgSlug(name: string) {
  const stem =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "workspace";

  return `${stem}-${randomUUID().slice(0, 8)}`;
}

/**
 * Return the user's organizations, creating a personal one if they have none.
 *
 * Idempotent and safe to call on every request. It is called from the signup
 * hook for the fast path, and again from `getOrgContext()` as a repair: a user
 * whose signup hook failed halfway would otherwise be permanently stuck with an
 * account that can load no data at all. Self-healing here is much cheaper than
 * a support ticket that can only be resolved with SQL.
 */
export async function ensurePersonalOrganization(user: {
  id: string;
  email?: string | null;
  nickname?: string | null;
}): Promise<OrganizationRow> {
  const existing = await findMembershipsByUserId(user.id);
  if (existing.length > 0) {
    // Prefer the personal org when the user belongs to several, so a brand new
    // session lands somewhere that is definitely theirs.
    const personal = existing.find(({ organization }) => organization.is_personal);
    return (personal ?? existing[0]).organization;
  }

  const name = personalOrgName(user);

  // Imported lazily on purpose. `src/lib/auth.ts` imports this module for its
  // signup hook, so a static import back would be a module cycle. Everything
  // here runs well after both modules are initialized.
  const { auth } = await import("@/lib/auth");

  const created = await auth.api.createOrganization({
    body: {
      name,
      slug: personalOrgSlug(name),
      // Server-side creation: there is no session yet when this runs from the
      // signup hook, so the plugin takes the owner explicitly.
      userId: user.id,
    },
  });

  if (!created) {
    throw new Error(`failed to create personal organization for user ${user.id}`);
  }

  await markOrganizationPersonal(created.id);

  return { ...(created as unknown as OrganizationRow), is_personal: true };
}
