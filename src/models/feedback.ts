import { feedbacks } from "@/db/schema";
import { db } from "@/db";
import { getUsersByUuids } from "./user";
import { desc, eq } from "drizzle-orm";

export async function insertFeedback(
  data: typeof feedbacks.$inferInsert
): Promise<typeof feedbacks.$inferSelect | undefined> {
  const [feedback] = await db().insert(feedbacks).values(data).returning();

  return feedback;
}

export async function findFeedbackById(
  id: number
): Promise<typeof feedbacks.$inferSelect | undefined> {
  const [feedback] = await db()
    .select()
    .from(feedbacks)
    .where(eq(feedbacks.id, id))
    .limit(1);

  return feedback;
}

export async function getFeedbacks(
  page: number = 1,
  limit: number = 50
): Promise<(typeof feedbacks.$inferSelect)[] | undefined> {
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

  const user_uuids = Array.from(new Set(data.map((item) => item.user_uuid)));
  const users = await getUsersByUuids(user_uuids as string[]);

  return data.map((item) => {
    const user = users?.find((user) => user.uuid === item.user_uuid);
    return { ...item, user };
  });
}

export async function getFeedbacksTotal(): Promise<number | undefined> {
  const total = await db().$count(feedbacks);

  return total;
}
