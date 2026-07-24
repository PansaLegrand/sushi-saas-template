import { desc, eq } from "drizzle-orm";
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
};

export async function listAdminUsers(page: number = 1, limit: number = 50) {
  const offset = (page - 1) * limit;

  return db()
    .select(adminUserColumns)
    .from(users)
    .orderBy(desc(users.created_at))
    .limit(limit)
    .offset(offset);
}

export async function countAdminUsers(): Promise<number> {
  return db().$count(users);
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
