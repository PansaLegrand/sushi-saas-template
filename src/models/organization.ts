import { and, asc, desc, eq, gt, ilike, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { orgInvitations, orgMembers, organizations, users } from "@/db/schema";

/** An organization row. Exported so services can type over rows without importing the schema. */
export type OrganizationRow = typeof organizations.$inferSelect;

/**
 * An organization uuid, distinguishable from a user uuid at compile time.
 *
 * Both are bare v4 uuids in a `string`, so nothing stops one being passed where
 * the other is expected — and nothing fails when it happens. Entitlements moved
 * from user-keyed to org-keyed during the tenancy work and four call sites kept
 * passing `userUuid`; every one of them compiled, ran, matched no subscription
 * row, and quietly reported the free plan. There is no runtime check that could
 * have caught it.
 *
 * The brand exists only in the type system: `asOrgUuid` is the single place a
 * plain string becomes one, and it should be called only on a value that came
 * out of an `organizations` row.
 */
export type OrgUuid = string & { readonly __brand: "OrgUuid" };

export function asOrgUuid(value: string): OrgUuid {
  return value as OrgUuid;
}

/** A membership row: which user belongs to which organization, in what role. */
export type OrgMemberRow = typeof orgMembers.$inferSelect;

/**
 * The roles the organization plugin ships with.
 *
 * They govern membership operations only — who may invite, remove, or promote.
 * What a member may do to a *file* or a *credit* is `can()` in
 * `src/services/authz.ts`, which is a separate question with a separate answer.
 */
export const OrgRole = {
  Owner: "owner",
  Admin: "admin",
  Member: "member",
} as const;

export type OrgRoleValue = (typeof OrgRole)[keyof typeof OrgRole];

export function isOrgRole(value: string | null | undefined): value is OrgRoleValue {
  return value === OrgRole.Owner || value === OrgRole.Admin || value === OrgRole.Member;
}

/** Every organization the user belongs to, with the role they hold in each. */
export async function findMembershipsByUserId(
  userId: string
): Promise<Array<{ member: OrgMemberRow; organization: OrganizationRow }>> {
  const rows = await db()
    .select({ member: orgMembers, organization: organizations })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.organization_id))
    .where(eq(orgMembers.user_id, userId));

  return rows;
}

/** A user's place in one organization: the membership row and the org it is in. */
export type Membership = { member: OrgMemberRow; organization: OrganizationRow };

/**
 * Resolve one membership by the org's public uuid.
 *
 * This is the query behind every authorization decision: it answers "is this
 * user in this org, and as what" in a single round trip, and returns undefined
 * rather than throwing so callers can decide between 401 and 404.
 */
export async function findMembership(
  userId: string,
  orgUuid: string
): Promise<Membership | undefined> {
  const [row] = await db()
    .select({ member: orgMembers, organization: organizations })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.organization_id))
    .where(and(eq(orgMembers.user_id, userId), eq(organizations.uuid, orgUuid)))
    .limit(1);

  return row;
}

/**
 * The same lookup, keyed by the slug that appears in the URL.
 *
 * Two lookups rather than one polymorphic "identifier" argument: a caller that
 * cannot tell you which kind of key it holds is a caller that will eventually
 * pass the wrong one, and both columns are unique strings so nothing would
 * fail loudly.
 */
export async function findMembershipBySlug(
  userId: string,
  slug: string
): Promise<Membership | undefined> {
  const [row] = await db()
    .select({ member: orgMembers, organization: organizations })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.organization_id))
    .where(and(eq(orgMembers.user_id, userId), eq(organizations.slug, slug)))
    .limit(1);

  return row;
}

export async function findOrganizationByUuid(
  uuid: string
): Promise<OrganizationRow | undefined> {
  const [row] = await db()
    .select()
    .from(organizations)
    .where(eq(organizations.uuid, uuid))
    .limit(1);

  return row;
}

/**
 * The organization a user's personal workspace is.
 *
 * Keyed on `users.uuid` because that is what application rows carry. Used to
 * attribute inbound Stripe events that name a person but not a tenant — every
 * user has exactly one personal org, so this is unambiguous.
 */
export async function findPersonalOrganizationByUserUuid(
  userUuid: string
): Promise<OrganizationRow | undefined> {
  const [row] = await db()
    .select({ organization: organizations })
    .from(organizations)
    .innerJoin(orgMembers, eq(orgMembers.organization_id, organizations.id))
    .innerJoin(users, eq(users.id, orgMembers.user_id))
    .where(and(eq(users.uuid, userUuid), eq(organizations.is_personal, true)))
    .limit(1);

  return row?.organization;
}

/** Reverse the Stripe customer linkage. Billing events arrive knowing only this. */
export async function findOrganizationByStripeCustomerId(
  customerId: string
): Promise<OrganizationRow | undefined> {
  const [row] = await db()
    .select()
    .from(organizations)
    .where(eq(organizations.stripe_customer_id, customerId))
    .limit(1);

  return row;
}

export async function setOrganizationStripeCustomerId(
  orgUuid: string,
  customerId: string
): Promise<void> {
  await db()
    .update(organizations)
    .set({ stripe_customer_id: customerId, updated_at: new Date() })
    .where(eq(organizations.uuid, orgUuid));
}

export async function findOrganizationById(
  id: string
): Promise<OrganizationRow | undefined> {
  const [row] = await db()
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);

  return row;
}

/** A member row joined to the person behind it, for the team screen. */
export async function listMembersWithUsers(
  orgId: string
): Promise<Array<{ member: OrgMemberRow; user: typeof users.$inferSelect }>> {
  return db()
    .select({ member: orgMembers, user: users })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.user_id))
    .where(eq(orgMembers.organization_id, orgId))
    // Owners first, then admins, then members — the order the screen reads in.
    .orderBy(
      sql`case ${orgMembers.role} when 'owner' then 0 when 'admin' then 1 else 2 end`,
      asc(orgMembers.created_at)
    );
}

/** An organization with its member count, for the admin list. */
export type AdminOrganizationRow = OrganizationRow & { member_count: number };

/**
 * Search organizations for the admin console.
 *
 * Unscoped by design — this is the one place that is supposed to see across
 * tenants, which is exactly why it lives here rather than growing inside
 * `apps/admin/lib/data.ts` where no layering rule reaches it.
 *
 * `stripe_customer_id` is searchable, and that is the point: an operator
 * starts from a Stripe dashboard tab holding `cus_...` and needs to know whose
 * it is. Going the other way — org to Stripe — is the same lookup reversed.
 */
export async function listOrganizationsForAdmin({
  query,
  page = 1,
  limit = 50,
}: {
  query?: string;
  page?: number;
  limit?: number;
}): Promise<AdminOrganizationRow[]> {
  const offset = (Math.max(page, 1) - 1) * limit;
  const where = adminOrganizationFilter(query);

  const rows = await db()
    .select({
      id: organizations.id,
      uuid: organizations.uuid,
      name: organizations.name,
      slug: organizations.slug,
      logo: organizations.logo,
      metadata: organizations.metadata,
      stripe_customer_id: organizations.stripe_customer_id,
      is_personal: organizations.is_personal,
      created_at: organizations.created_at,
      updated_at: organizations.updated_at,
      // A join and GROUP BY rather than a correlated subquery, and not for
      // taste. Drizzle renders interpolated columns *unqualified* inside a `sql`
      // template, so the obvious subquery becomes:
      //
      //   select count(*) from "org_members" where "organization_id" = "id"
      //
      // where `"id"` binds to `org_members.id` — the inner scope shadows the
      // outer one. Both columns exist, so nothing errors: every count comes back
      // 0. `count(org_members.id)` over a LEFT JOIN has no such ambiguity, and
      // GROUP BY runs before LIMIT so a page still holds `limit` organizations.
      member_count: sql<number>`count(${orgMembers.id})::int`,
    })
    .from(organizations)
    .leftJoin(orgMembers, eq(orgMembers.organization_id, organizations.id))
    .where(where ?? sql`true`)
    .groupBy(organizations.id)
    .orderBy(desc(organizations.created_at))
    .limit(limit)
    .offset(offset);

  return rows;
}

export async function countOrganizationsForAdmin(
  query?: string
): Promise<number> {
  const where = adminOrganizationFilter(query);
  const [row] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(organizations)
    .where(where ?? sql`true`);

  return row?.count ?? 0;
}

/**
 * Shared so the list and its count cannot drift — a paginator whose total is
 * computed from a different filter than its rows is worse than no total.
 */
function adminOrganizationFilter(query?: string): SQL | undefined {
  const term = query?.trim();
  if (!term) return undefined;

  const like = `%${term}%`;
  return or(
    ilike(organizations.name, like),
    ilike(organizations.slug, like),
    ilike(organizations.uuid, like),
    ilike(organizations.stripe_customer_id, like)
  );
}

/** Invitations still awaiting a decision. Expired ones are not actionable. */
export async function listPendingInvitations(
  orgId: string
): Promise<Array<typeof orgInvitations.$inferSelect>> {
  return db()
    .select()
    .from(orgInvitations)
    .where(
      and(
        eq(orgInvitations.organization_id, orgId),
        eq(orgInvitations.status, "pending"),
        gt(orgInvitations.expires_at, new Date())
      )
    )
    .orderBy(desc(orgInvitations.created_at));
}

/**
 * One invitation by its id, with the organization it grants access to.
 *
 * Necessarily unscoped: the recipient is not yet a member of that organization,
 * so there is no tenant context to scope by. The invitation id *is* the
 * credential, which is why the route re-checks the invited address against the
 * session before acting on it.
 */
export async function findInvitationById(
  id: string
): Promise<
  | { id: string; email: string; status: string; expires_at: Date; organization: OrganizationRow }
  | undefined
> {
  const [row] = await db()
    .select({ invitation: orgInvitations, organization: organizations })
    .from(orgInvitations)
    .innerJoin(organizations, eq(organizations.id, orgInvitations.organization_id))
    .where(eq(orgInvitations.id, id))
    .limit(1);

  if (!row) return undefined;

  return {
    id: row.invitation.id,
    email: row.invitation.email,
    status: row.invitation.status,
    expires_at: row.invitation.expires_at,
    organization: row.organization,
  };
}

/**
 * One membership by its own id, scoped to the organization.
 *
 * The org is part of the lookup, not a check afterwards: a member id from
 * another tenant must resolve to nothing rather than to a row the caller then
 * has to remember to compare.
 */
export async function findMembershipById(
  orgId: string,
  memberId: string
): Promise<OrgMemberRow | undefined> {
  const [row] = await db()
    .select()
    .from(orgMembers)
    .where(and(eq(orgMembers.organization_id, orgId), eq(orgMembers.id, memberId)))
    .limit(1);

  return row;
}

/** How many owners an organization has. Never allowed to reach zero. */
export async function countOwners(orgId: string): Promise<number> {
  return db().$count(
    orgMembers,
    and(eq(orgMembers.organization_id, orgId), eq(orgMembers.role, OrgRole.Owner))
  );
}

/**
 * The tenant scope predicate. Every query against an org-owned table goes
 * through this.
 *
 * It is a one-line function, and that is the point. The catastrophic failure of
 * multi-tenancy is not a complicated bug — it is one forgotten `where` clause
 * that shows Acme's files to Initech. A named helper gives that clause a single
 * definition, makes an unscoped query visible in review, and gives
 * `tests/unit/architecture.test.ts` something mechanical to enforce.
 *
 *   db().select().from(files).where(scopedToOrg(files.org_uuid, ctx.orgUuid))
 *
 * Combine with other conditions using `and(...)`, never by replacing it.
 */
export function scopedToOrg(column: PgColumn, orgUuid: string): SQL {
  if (!orgUuid) {
    // An empty scope would match every row whose column is also empty, which
    // during the nullable window is a large and arbitrary slice of the table.
    // Failing loudly beats returning another tenant's data.
    throw new Error("scopedToOrg called without an organization uuid");
  }

  return eq(column, orgUuid);
}

/**
 * Flag an organization as the one created for a user at signup.
 *
 * A separate statement rather than a field on the create call: the plugin
 * declares `is_personal` as a non-input field, so it is ours to set, not
 * something a request body can claim.
 */
export async function markOrganizationPersonal(id: string): Promise<void> {
  await db()
    .update(organizations)
    .set({ is_personal: true, updated_at: new Date() })
    .where(eq(organizations.id, id));
}
