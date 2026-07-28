import {
  and,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  affiliates,
  feedbacks,
  orders,
  reservationServices,
  reservations,
  users,
} from "@/db/schema";
import { OrderStatus } from "@/models/order";
import { getUsersByUuids } from "@/models/user";

// Explicit allowlist: a bare `select()` ships signin_ip, signin_openid,
// stripe_customer_id, and invite_code to the browser for every user.
const adminUserColumns = {
  id: users.id,
  uuid: users.uuid,
  email: users.email,
  nickname: users.nickname,
  avatar_url: users.avatar_url,
  locale: users.locale,
  signin_provider: users.signin_provider,
  email_verified: users.email_verified,
  is_affiliate: users.is_affiliate,
  role: users.role,
  created_at: users.created_at,
  last_signin_at: users.last_signin_at,
  updated_at: users.updated_at,
  // Every user list in the console shows suspension state. A banned account
  // that looks identical to an active one in the table is how an operator
  // spends ten minutes debugging why someone "cannot log in".
  banned_at: users.banned_at,
  ban_reason: users.ban_reason,
  banned_by: users.banned_by,
};

/**
 * Shared between the list and its count so a paginator's total cannot be
 * computed from a different filter than its rows.
 *
 * Searching `uuid` and not just `email` is the point rather than a nicety: every
 * write tool in the console — credits, plan, suspend — is keyed on the uuid, so
 * the operator's job is to turn whatever they arrived with (an address from a
 * support ticket, a partial id from a log line) into one. `nickname` is included
 * because it is the only other name a human uses for an account.
 *
 * Deliberately not searched: `signin_ip` and `stripe_customer_id`. A Stripe
 * customer belongs to the *organization*, which is where `/organizations`
 * already searches for it, and an IP search is a surveillance surface with no
 * support question behind it.
 */
function adminUserFilter(query?: string): SQL | undefined {
  const term = query?.trim();
  if (!term) return undefined;

  const like = `%${term}%`;
  return or(
    ilike(users.email, like),
    ilike(users.uuid, like),
    ilike(users.nickname, like)
  );
}

export async function listAdminUsers({
  query,
  page = 1,
  limit = 50,
}: { query?: string; page?: number; limit?: number } = {}) {
  const offset = (page - 1) * limit;

  return db()
    .select(adminUserColumns)
    .from(users)
    .where(adminUserFilter(query))
    .orderBy(desc(users.created_at))
    .limit(limit)
    .offset(offset);
}

/**
 * Signups since a cutoff.
 *
 * The overview's one rate rather than a total, and the reason is abuse: a
 * standing user count moves too slowly to notice anything, while "how many
 * arrived this week" is where a bot wave shows up as a number that does not
 * match the product. It is a pointer to `/moderation`, not a growth metric.
 */
export async function countAdminUsersSince(since: Date): Promise<number> {
  return db().$count(users, gte(users.created_at, since));
}

export async function countAdminUsers(query?: string): Promise<number> {
  const [row] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(adminUserFilter(query) ?? sql`true`);

  return row?.count ?? 0;
}

/** Suspended accounts, most recent first. Backs the moderation page's list. */
export async function listAdminBannedUsers(
  page: number = 1,
  limit: number = 50
) {
  const offset = (page - 1) * limit;

  return db()
    .select(adminUserColumns)
    .from(users)
    .where(isNotNull(users.banned_at))
    .orderBy(desc(users.banned_at))
    .limit(limit)
    .offset(offset);
}

/**
 * How many accounts are suspended.
 *
 * Kept beside the list rather than in the model layer for the same reason the
 * other four list/count pairs in this file are: a total derived from a different
 * predicate than the rows is a paginator that lies. Here the predicate is one
 * `isNotNull`, and it still has to be the same one.
 */
export async function countAdminBannedUsers(): Promise<number> {
  return db().$count(users, isNotNull(users.banned_at));
}

export async function listAdminPaidOrders(page: number = 1, limit: number = 50) {
  const offset = (page - 1) * limit;

  return db()
    .select()
    .from(orders)
    .where(eq(orders.status, OrderStatus.Paid))
    .orderBy(desc(orders.created_at))
    .limit(limit)
    .offset(offset);
}

// The same reasoning as `adminUserColumns`. `order_detail` and `paid_detail`
// are unbounded text blobs holding whatever the payment provider returned —
// they are not needed to answer an operator's question, and a column nobody
// renders is a column that cannot leak.
const adminOrderColumns = {
  id: orders.id,
  order_no: orders.order_no,
  status: orders.status,
  org_uuid: orders.org_uuid,
  user_uuid: orders.user_uuid,
  user_email: orders.user_email,
  amount: orders.amount,
  currency: orders.currency,
  credits: orders.credits,
  interval: orders.interval,
  product_id: orders.product_id,
  product_name: orders.product_name,
  sub_id: orders.sub_id,
  sub_period_start: orders.sub_period_start,
  sub_period_end: orders.sub_period_end,
  stripe_session_id: orders.stripe_session_id,
  created_at: orders.created_at,
  paid_at: orders.paid_at,
  expired_at: orders.expired_at,
};

/**
 * Shared by the list and its count.
 *
 * Searching `order_no` matters most: the numbers are now three different shapes
 * — `renewal:<sub>:<period>`, a UUIDv7, and old numeric ids — and an operator
 * arriving from a Stripe invoice or a support ticket has whichever one was in
 * front of them. `sub_id` is in here for the same reason: from a subscription
 * id you can find every cycle it ever billed.
 */
function adminOrderFilter(input: {
  status?: string;
  query?: string;
}): SQL | undefined {
  const clauses: SQL[] = [];

  if (input.status) clauses.push(eq(orders.status, input.status));

  const term = input.query?.trim();
  if (term) {
    const like = `%${term}%`;
    const match = or(
      ilike(orders.order_no, like),
      ilike(orders.user_uuid, like),
      ilike(orders.org_uuid, like),
      ilike(orders.user_email, like),
      ilike(orders.sub_id, like)
    );
    if (match) clauses.push(match);
  }

  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

export async function listAdminOrders({
  status,
  query,
  page = 1,
  limit = 50,
}: {
  status?: string;
  query?: string;
  page?: number;
  limit?: number;
} = {}) {
  const offset = (page - 1) * limit;

  return db()
    .select(adminOrderColumns)
    .from(orders)
    .where(adminOrderFilter({ status, query }))
    // `created_at` is nullable on this table (see the roadmap's "normalize
    // nullable timestamps" item), so the id breaks the tie rather than leaving
    // rows in whatever order the scan produced.
    .orderBy(desc(orders.created_at), desc(orders.id))
    .limit(limit)
    .offset(offset);
}

export async function countAdminOrders(input: {
  status?: string;
  query?: string;
} = {}): Promise<number> {
  const [row] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(adminOrderFilter(input) ?? sql`true`);

  return row?.count ?? 0;
}

/** Row counts per order status, for the filter tabs. */
export async function countAdminOrdersByStatus(): Promise<
  Record<string, number>
> {
  const rows = await db()
    .select({ status: orders.status, count: sql<number>`count(*)::int` })
    .from(orders)
    .groupBy(orders.status);

  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

export async function countAdminPaidOrders(): Promise<number> {
  return db().$count(orders, eq(orders.status, OrderStatus.Paid));
}

export async function listAdminFeedbacks(page: number = 1, limit: number = 50) {
  const offset = (page - 1) * limit;

  const data = await db()
    .select()
    .from(feedbacks)
    .orderBy(desc(feedbacks.created_at))
    .limit(limit)
    .offset(offset);

  if (!data || data.length === 0) {
    return [];
  }

  const userUuids = Array.from(new Set(data.map((item) => item.user_uuid)));
  const feedbackUsers = await getUsersByUuids(userUuids as string[]);

  return data.map((item) => {
    const user = feedbackUsers?.find((u) => u.uuid === item.user_uuid);
    return { ...item, user };
  });
}

export async function countAdminFeedbacks(): Promise<number> {
  return db().$count(feedbacks);
}

export async function countAdminAffiliates(): Promise<number> {
  return db().$count(affiliates);
}

export async function listAdminAffiliates(page: number = 1, limit: number = 50) {
  const offset = (page - 1) * limit;

  const data = await db()
    .select()
    .from(affiliates)
    .orderBy(desc(affiliates.created_at))
    .limit(limit)
    .offset(offset);

  if (!data || data.length === 0) {
    return [];
  }

  const userUuids = Array.from(new Set(data.map((item) => item.user_uuid)));
  const invitedByUuids = Array.from(new Set(data.map((item) => item.invited_by)));

  const [affiliateUsers, invitedByUsers] = await Promise.all([
    getUsersByUuids(userUuids as string[]),
    getUsersByUuids(invitedByUuids as string[]),
  ]);

  return data.map((item) => {
    const user = affiliateUsers?.find((u) => u.uuid === item.user_uuid);
    const invitedBy = invitedByUsers?.find((u) => u.uuid === item.invited_by);
    return { ...item, user, invited_by_user: invitedBy };
  });
}

export async function countAdminReservations(): Promise<number> {
  return db().$count(reservations);
}

export async function listAdminReservationsWithService(
  page: number = 1,
  limit: number = 50
) {
  const offset = (page - 1) * limit;
  const rows = await db()
    .select({ r: reservations, s: reservationServices })
    .from(reservations)
    .leftJoin(reservationServices, eq(reservations.service_id, reservationServices.id))
    .orderBy(reservations.start_at)
    .limit(limit)
    .offset(offset);

  return rows.map((row) => ({ ...row.r, service: row.s }));
}
