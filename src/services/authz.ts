import { auth } from "@/lib/auth";
import {
  ORGANIZATION_CONTEXT_MODE_HEADER,
  ORGANIZATION_HEADER,
  ORGANIZATION_QUERY_PARAM,
  normalizeOrganizationSlug,
} from "@/config/organization-context";
import { AppError } from "@/lib/errors";
import {
  findMembershipBySlug,
  findMembershipsByUserId,
  asOrgUuid,
  isOrgRole,
  OrgRole,
  type Membership,
  type OrgRoleValue,
  type OrgUuid,
} from "@/models/organization";
import { findUserById } from "@/models/user";

import { ensurePersonalOrganization } from "./organizations";

/**
 * The single door for "who is asking, in which organization, and may they do
 * this".
 *
 * Every authorization decision in the application funnels through the two
 * exports here. That is not tidiness — it is what makes the tenancy model
 * replaceable. `getOrgContext()` is the one place that knows how a request maps
 * to an organization, and `can()` is the one place that knows what a role
 * permits, so changing either is a change to one file rather than a grep across
 * forty call sites.
 *
 * This is a different axis from plan entitlements. Three separate questions,
 * deliberately never merged:
 *
 *   can(ctx, "file:delete", file)      → does this member's ROLE allow it
 *   hasEntitlement(plan, "storage")    → does this org's PLAN include it
 *   auth.api.hasPermission(...)        → may they manage the MEMBERSHIP itself
 *
 * A plan and a role disagreeing is normal — a `member` on the max tier still
 * cannot delete the organization. Collapsing them into one check is how that
 * stops being expressible.
 */

export interface OrgContext {
  userId: string;
  userUuid: string;
  /** Better Auth's id. Internal only — never put it in a URL or a payload. */
  orgId: string;
  /** The public identifier every tenant table references. */
  orgUuid: OrgUuid;
  orgSlug: string;
  orgName: string;
  /** True for the workspace created at signup. It cannot be left or deleted. */
  orgIsPersonal: boolean;
  role: OrgRoleValue;
}

export interface OrgWorkspace {
  slug: string;
  name: string;
  isPersonal: boolean;
  role: OrgRoleValue;
}

export interface OrgNavigationState {
  /** The browser needs display/routing fields only; internal ids stay server-side. */
  current: Pick<OrgContext, "orgSlug" | "orgName" | "role">;
  workspaces: OrgWorkspace[];
}

/**
 * What a member may do to the organization's own resources.
 *
 * Membership operations — invite, remove, promote — are the organization
 * plugin's `has-permission`, not this list. These are the application's verbs.
 */
export type OrgAction =
  | "org:read"
  | "org:update"
  | "org:delete"
  | "member:read"
  | "member:manage"
  | "billing:read"
  | "billing:manage"
  | "file:read"
  | "file:create"
  | "file:delete"
  | "task:read"
  | "task:create"
  | "credit:read"
  | "credit:spend";

/**
 * Roles nest: an owner can do everything an admin can, an admin everything a
 * member can. Spelling the tiers out as supersets rather than three independent
 * lists means a new action added to `MEMBER` cannot be accidentally withheld
 * from owners.
 */
const MEMBER_ACTIONS: readonly OrgAction[] = [
  "org:read",
  "member:read",
  "billing:read",
  "file:read",
  "file:create",
  // Members delete organization content, including content another member
  // uploaded. That follows from the access model we chose: if you are in the
  // org you see its data, and your role decides the operation — not who
  // happened to create the row. Restricting deletes to the creator is the first
  // thing the `resource` argument to `can()` will be used for.
  "file:delete",
  "task:read",
  "task:create",
  "credit:read",
  "credit:spend",
];

const ADMIN_ACTIONS: readonly OrgAction[] = [
  ...MEMBER_ACTIONS,
  "org:update",
  "member:manage",
];

const OWNER_ACTIONS: readonly OrgAction[] = [
  ...ADMIN_ACTIONS,
  "org:delete",
  // Owner-only on purpose: the owner is who the subscription is billed to, and
  // an admin changing the plan spends someone else's money. Move it up to
  // ADMIN_ACTIONS if your product wants delegated billing — one line, and
  // tests/services/authz.test.ts will tell you exactly what changed.
  "billing:manage",
];

const POLICY: Record<OrgRoleValue, ReadonlySet<OrgAction>> = {
  [OrgRole.Member]: new Set(MEMBER_ACTIONS),
  [OrgRole.Admin]: new Set(ADMIN_ACTIONS),
  [OrgRole.Owner]: new Set(OWNER_ACTIONS),
};

/**
 * May this member perform this action?
 *
 * `resource` is accepted and deliberately unused. Today the answer depends only
 * on the role, because access is organization-wide. When per-resource sharing
 * or creator-only deletes arrive, they become a change inside this function —
 * whereas a signature without the argument would make them a change at every
 * call site in the codebase. Passing it now costs nothing and is the whole
 * reason the upgrade stays additive.
 */
export function can(
  ctx: Pick<OrgContext, "role">,
  action: OrgAction,
  _resource?: unknown
): boolean {
  return POLICY[ctx.role]?.has(action) ?? false;
}

/** Every action the role permits. For rendering UI without probing `can()` per button. */
export function allowedActions(role: OrgRoleValue): OrgAction[] {
  return [...(POLICY[role] ?? [])];
}

/**
 * Resolve the acting organization for a request.
 *
 * `orgSlug` comes from the URL. Path-scoped rather than session-scoped on
 * purpose: with the org held only in the session, two browser tabs open on two
 * organizations fight over one value and the loser silently acts in the wrong
 * tenant. The session's `activeOrganizationId` is kept as a landing preference
 * for URLs that name no org, never as the authorization input.
 *
 * Returns null when there is no session, or when the user is not a member of
 * the named organization. Callers decide between 401 and 404 — this function
 * does not leak which of the two it was.
 */
export async function getOrgContextFromHeaders(
  requestHeaders: Headers,
  orgSlug?: string,
  options: { requireExplicitForMultiple?: boolean } = {}
): Promise<OrgContext | null> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;

  const userId = session.user.id;
  if (!userId) return null;

  // Always read lifecycle state from the database, even when the session
  // already carries the public uuid. A session is a cached identity snapshot;
  // letting it authorize an erasing user reopens the race where this function
  // repairs the personal workspace the worker is deleting.
  const storedUser = await findUserById(userId);
  if (!storedUser || storedUser.lifecycle_status === "erasing") return null;

  const userUuid =
    ((session.user as { uuid?: string }).uuid ??
      storedUser.uuid) ||
    null;
  if (!userUuid) return null;

  const rawExplicitSlug = orgSlug ?? requestHeaders.get(ORGANIZATION_HEADER);
  const explicitSlug = normalizeOrganizationSlug(rawExplicitSlug);

  // A supplied but malformed value is not the same as no value. Refuse it
  // rather than falling back to a different workspace.
  if (rawExplicitSlug != null && !explicitSlug) return null;

  // Named in the URL/header: resolve exactly that org, or refuse. Never fall back to
  // another organization here — silently serving a different tenant's data than
  // the URL asked for is the worst possible outcome of a bad link.
  if (explicitSlug) {
    const membership = await findMembershipBySlug(userId, explicitSlug);
    if (!membership) return null;

    return toContext(userId, userUuid, membership);
  }

  const memberships = await findMembershipsByUserId(userId);

  if (memberships.length === 0) {
    // Repair. A user whose signup hook failed part-way would otherwise have an
    // account that can load nothing at all, fixable only with SQL. This is
    // idempotent, so the cost of it running spuriously is one extra query.
    const organization = await ensurePersonalOrganization({
      id: userId,
      email: session.user.email,
      nickname: session.user.name,
    });

    return {
      userId,
      userUuid,
      orgId: organization.id,
      orgUuid: asOrgUuid(organization.uuid),
      orgSlug: organization.slug,
      orgName: organization.name,
      orgIsPersonal: organization.is_personal,
      role: OrgRole.Owner,
    };
  }

  const requireExplicit =
    options.requireExplicitForMultiple ??
    requestHeaders.get(ORGANIZATION_CONTEXT_MODE_HEADER) === "api";

  if (memberships.length > 1 && requireExplicit) {
    throw new AppError("ORG_CONTEXT_REQUIRED", {
      message:
        "a user with multiple workspaces made an API request without an explicit organization",
    });
  }

  const activeId = (session.session as { activeOrganizationId?: string | null })
    .activeOrganizationId;

  const active = activeId
    ? memberships.find(({ organization }) => organization.id === activeId)
    : undefined;

  const personal = memberships.find(({ organization }) => organization.is_personal);

  return toContext(userId, userUuid, active ?? personal ?? memberships[0]);
}

/** The same resolution for route handlers, which hold a `Request`. */
export async function getOrgContext(
  req: Request,
  orgSlug?: string
): Promise<OrgContext | null> {
  const requestedSlug =
    orgSlug ??
    new URL(req.url).searchParams.get(ORGANIZATION_QUERY_PARAM) ??
    undefined;

  return getOrgContextFromHeaders(req.headers, requestedSlug, {
    // API requests must never pick a tenant from session-global state when the
    // user belongs to more than one. A page may use that value once as a
    // landing preference, then the account shell writes the choice into its
    // tab-local URL.
    requireExplicitForMultiple: true,
  });
}

/**
 * Workspace data for the account shell.
 *
 * This deliberately uses the non-strict page resolution above: a legacy
 * `/account/...` link may land via the session preference once. The client
 * shell immediately canonicalizes it to `?org=<slug>`, after which every link
 * and API request is explicit and independent across browser tabs.
 */
export async function getOrgNavigationStateFromHeaders(
  requestHeaders: Headers
): Promise<OrgNavigationState | null> {
  const current = await getOrgContextFromHeaders(requestHeaders);
  if (!current) return null;

  const memberships = await findMembershipsByUserId(current.userId);
  const workspaces = memberships
    .map(({ member, organization }) => ({
      slug: organization.slug,
      name: organization.name,
      isPersonal: organization.is_personal,
      role: isOrgRole(member.role) ? member.role : OrgRole.Member,
    }))
    .sort(
      (a, b) =>
        Number(b.isPersonal) - Number(a.isPersonal) ||
        a.name.localeCompare(b.name)
    );

  return {
    current: {
      orgSlug: current.orgSlug,
      orgName: current.orgName,
      role: current.role,
    },
    workspaces,
  };
}

function toContext(
  userId: string,
  userUuid: string,
  membership: Membership
): OrgContext {
  const { member, organization } = membership;

  return {
    userId,
    userUuid,
    orgId: organization.id,
    orgUuid: asOrgUuid(organization.uuid),
    orgSlug: organization.slug,
    orgName: organization.name,
    orgIsPersonal: organization.is_personal,
    // A role the code does not recognize is treated as the least privileged one
    // rather than trusted. A typo in a manual SQL update must not grant
    // anything.
    role: isOrgRole(member.role) ? member.role : OrgRole.Member,
  };
}
