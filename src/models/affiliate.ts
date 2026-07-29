import { affiliates } from "@/db/schema";
import { db } from "@/db";
import { getUsersByUuids } from "./user";
import { and, desc, eq, ne } from "drizzle-orm";

export async function insertAffiliate(
  data: typeof affiliates.$inferInsert,
): Promise<typeof affiliates.$inferSelect | undefined> {
  const [affiliate] = await db().insert(affiliates).values(data).returning();

  return affiliate;
}

/**
 * Record the commission for a paid order exactly once.
 *
 * Stripe may deliver two different events for the same payment concurrently,
 * and those events may run on different application instances. A lookup before
 * an insert cannot serialize that race; the partial unique index on
 * `paid_order_no` does. Returning `undefined` is the expected replay outcome.
 */
export async function insertPaidAffiliateOnce(
  data: typeof affiliates.$inferInsert,
): Promise<typeof affiliates.$inferSelect | undefined> {
  const [affiliate] = await db()
    .insert(affiliates)
    .values(data)
    .onConflictDoNothing()
    .returning();

  return affiliate;
}

/** One zero-value attribution row per invited account. */
export async function insertSignupAffiliateOnce(
  data: typeof affiliates.$inferInsert,
): Promise<typeof affiliates.$inferSelect | undefined> {
  const [affiliate] = await db()
    .insert(affiliates)
    .values(data)
    .onConflictDoNothing()
    .returning();

  return affiliate;
}

export async function findAffiliateByUserUuid(
  user_uuid: string,
): Promise<typeof affiliates.$inferSelect | undefined> {
  const [affiliate] = await db()
    .select()
    .from(affiliates)
    .where(eq(affiliates.user_uuid, user_uuid))
    .limit(1);

  return affiliate;
}

export async function getAffiliatesByUserUuid(
  user_uuid: string,
  page: number = 1,
  limit: number = 50,
): Promise<(typeof affiliates.$inferSelect)[] | undefined> {
  const offset = (page - 1) * limit;

  const data = await db()
    .select()
    .from(affiliates)
    .where(eq(affiliates.invited_by, user_uuid))
    .orderBy(desc(affiliates.created_at))
    .limit(limit)
    .offset(offset);

  if (!data || data.length === 0) {
    return undefined;
  }

  const user_uuids = Array.from(new Set(data.map((item) => item.user_uuid)));

  const users = await getUsersByUuids(user_uuids as string[]);
  return data.map((item) => {
    const user = users?.find((user) => user.uuid === item.user_uuid);
    return { ...item, user };
  });
}

export async function getAffiliateSummary(user_uuid: string) {
  const data = await db()
    .select()
    .from(affiliates)
    .where(eq(affiliates.invited_by, user_uuid));

  const summary = {
    total_invited: 0,
    total_paid: 0,
    total_reward: 0,
  };

  const invited_users = new Set();
  const paid_users = new Set();

  data.forEach((item) => {
    invited_users.add(item.user_uuid);
    if (item.paid_amount > 0) {
      paid_users.add(item.user_uuid);

      summary.total_reward += item.reward_amount;
    }
  });

  summary.total_invited = invited_users.size;
  summary.total_paid = paid_users.size;

  return summary;
}

export async function findAffiliateByOrderNo(order_no: string) {
  const [affiliate] = await db()
    .select()
    .from(affiliates)
    .where(eq(affiliates.paid_order_no, order_no))
    .limit(1);

  return affiliate;
}

export async function cancelPendingAffiliateByOrderNo(
  orderNo: string,
  canceledStatus: string,
): Promise<typeof affiliates.$inferSelect | undefined> {
  const [affiliate] = await db()
    .update(affiliates)
    .set({ status: canceledStatus })
    .where(
      and(
        eq(affiliates.paid_order_no, orderNo),
        ne(affiliates.status, canceledStatus),
      ),
    )
    .returning();

  return affiliate;
}
