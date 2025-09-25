import { affiliates } from "@/db/schema";
import { db } from "@/db";
import { getUsersByUuids } from "./user";
import { desc, eq } from "drizzle-orm";

export async function insertAffiliate(
  data: typeof affiliates.$inferInsert
): Promise<typeof affiliates.$inferSelect | undefined> {
  const [affiliate] = await db().insert(affiliates).values(data).returning();

  return affiliate;
}

export async function findAffiliateByUserUuid(
  user_uuid: string
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
  limit: number = 50
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

export async function getAllAffiliates(
  page: number = 1,
  limit: number = 50
): Promise<(typeof affiliates.$inferSelect)[] | undefined> {
  const offset = (page - 1) * limit;

  const data = await db()
    .select()
    .from(affiliates)
    .orderBy(desc(affiliates.created_at))
    .limit(limit)
    .offset(offset);

  if (!data || data.length === 0) {
    return undefined;
  }

  const user_uuids = Array.from(new Set(data.map((item) => item.user_uuid)));
  const invited_by_uuids = Array.from(
    new Set(data.map((item) => item.invited_by))
  );

  const users = await getUsersByUuids(user_uuids as string[]);
  const invited_by_users = await getUsersByUuids(invited_by_uuids as string[]);

  return data.map((item) => {
    const user = users?.find((user) => user.uuid === item.user_uuid);
    const invited_by = invited_by_users?.find(
      (user) => user.uuid === item.invited_by
    );
    return { ...item, user, invited_by_user: invited_by };
  });
}
