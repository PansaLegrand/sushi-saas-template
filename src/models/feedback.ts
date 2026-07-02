import { feedbacks } from "@/db/schema";
import { db } from "@/db";
import { eq } from "drizzle-orm";

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
