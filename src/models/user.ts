import { users } from "@/db/schema";
import { db } from "@/db";
import { and, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";

export async function insertUser(
  data: typeof users.$inferInsert
): Promise<typeof users.$inferSelect | undefined> {
  const [user] = await db().insert(users).values(data).returning();

  return user;
}

export async function findUserByEmail(
  email: string
): Promise<typeof users.$inferSelect | undefined> {
  const [user] = await db()
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return user;
}

export async function updateUserLastSignin(
  uuid: string,
  when: Date
): Promise<void> {
  await db()
    .update(users)
    .set({ last_signin_at: when })
    .where(eq(users.uuid, uuid));
}

export async function findUserById(
  id: string
): Promise<typeof users.$inferSelect | undefined> {
  const [user] = await db()
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return user;
}

export async function findUserByUuid(
  uuid: string
): Promise<typeof users.$inferSelect | undefined> {
  const [user] = await db()
    .select()
    .from(users)
    .where(eq(users.uuid, uuid))
    .limit(1);

  return user;
}

/**
 * Look a user up by their Stripe customer id.
 *
 * The subscription webhook needs this: a `customer.subscription.*` event names
 * a customer, and the metadata that would name the user directly is only on
 * objects we created ourselves. This is the fallback that keeps an event
 * created from the Stripe dashboard — a manual upgrade, a support fix — from
 * arriving with nobody to attach it to.
 */
export async function findUserByStripeCustomerId(
  stripe_customer_id: string
): Promise<typeof users.$inferSelect | undefined> {
  const [user] = await db()
    .select()
    .from(users)
    .where(eq(users.stripe_customer_id, stripe_customer_id))
    .limit(1);

  return user;
}

export async function updateUserInviteCode(
  user_uuid: string,
  invite_code: string
): Promise<typeof users.$inferSelect | undefined> {
  const [user] = await db()
    .update(users)
    .set({ invite_code, updated_at: new Date() })
    .where(eq(users.uuid, user_uuid))
    .returning();

  return user;
}

export async function updateUserInvitedBy(
  user_uuid: string,
  invited_by: string
): Promise<typeof users.$inferSelect | undefined> {
  const [user] = await db()
    .update(users)
    .set({ invited_by, updated_at: new Date() })
    // First-touch attribution. Two tabs may mount the attribution provider at
    // once; only the update that still sees an empty value may claim it.
    .where(and(eq(users.uuid, user_uuid), eq(users.invited_by, "")))
    .returning();

  return user;
}

export async function getUsersByUuids(
  user_uuids: string[]
): Promise<(typeof users.$inferSelect)[] | undefined> {
  const data = await db()
    .select()
    .from(users)
    .where(inArray(users.uuid, user_uuids));

  return data;
}

export async function findUserByInviteCode(
  invite_code: string
): Promise<typeof users.$inferSelect | undefined> {
  const [user] = await db()
    .select()
    .from(users)
    .where(eq(users.invite_code, invite_code))
    .limit(1);

  return user;
}

export async function getUserUuidsByEmail(
  email: string
): Promise<string[] | undefined> {
  const data = await db()
    .select({ uuid: users.uuid })
    .from(users)
    .where(eq(users.email, email));

  return data.map((user) => user.uuid);
}

export async function getUserCountByDate(
  startTime: string
): Promise<Map<string, number> | undefined> {
  const data = await db()
    .select({ created_at: users.created_at })
    .from(users)
    .where(gte(users.created_at, new Date(startTime)));

  data.sort((a, b) => a.created_at!.getTime() - b.created_at!.getTime());

  const dateCountMap = new Map<string, number>();
  data.forEach((item) => {
    const date = item.created_at!.toISOString().split("T")[0];
    dateCountMap.set(date, (dateCountMap.get(date) || 0) + 1);
  });

  return dateCountMap;
}

export type UserRole = "user" | "admin_ro" | "admin_rw";

export async function updateUserRole(
  user_uuid: string,
  role: UserRole
): Promise<typeof users.$inferSelect | undefined> {
  const [user] = await db()
    .update(users)
    .set({ role, updated_at: new Date() })
    .where(eq(users.uuid, user_uuid))
    .returning();

  return user;
}

/**
 * Suspend an account, unless it already is.
 *
 * The `isNull(banned_at)` predicate is the whole point: a second ban must not
 * overwrite the first one's timestamp, reason, or author. When someone re-bans
 * an account during an incident, "banned an hour ago for X" is the fact worth
 * keeping and "banned just now for see above" is the one that destroys it.
 *
 * Returns undefined when the row was already banned or does not exist. The
 * caller distinguishes those by looking the user up first.
 */
export async function markUserBanned(params: {
  user_uuid: string;
  reason: string | null;
  banned_by: string;
  when?: Date;
}): Promise<typeof users.$inferSelect | undefined> {
  const now = params.when ?? new Date();

  const [user] = await db()
    .update(users)
    .set({
      banned_at: now,
      ban_reason: params.reason,
      banned_by: params.banned_by,
      updated_at: now,
    })
    .where(and(eq(users.uuid, params.user_uuid), isNull(users.banned_at)))
    .returning();

  return user;
}

/** Lift a suspension. Returns undefined when the account was not banned. */
export async function markUserUnbanned(
  user_uuid: string
): Promise<typeof users.$inferSelect | undefined> {
  const [user] = await db()
    .update(users)
    .set({
      banned_at: null,
      ban_reason: null,
      banned_by: "",
      updated_at: new Date(),
    })
    .where(and(eq(users.uuid, user_uuid), isNotNull(users.banned_at)))
    .returning();

  return user;
}

/**
 * Every account sharing an email address, across providers.
 *
 * `users.email` is unique per `signin_provider`, so one address can hold
 * several rows — a password account and a Google one are two rows that the same
 * person signs in to. Banning the row an abuser happened to be using leaves the
 * others open, so the ban service uses this to reach all of them.
 */
export async function findUsersByEmail(
  email: string
): Promise<(typeof users.$inferSelect)[]> {
  return db().select().from(users).where(eq(users.email, email));
}

export async function updateUserStripeCustomerId(
  user_uuid: string,
  stripe_customer_id: string
): Promise<typeof users.$inferSelect | undefined> {
  const [user] = await db()
    .update(users)
    .set({ stripe_customer_id, updated_at: new Date() })
    .where(eq(users.uuid, user_uuid))
    .returning();

  return user;
}
