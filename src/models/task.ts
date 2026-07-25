import { tasks } from "@/db/schema";
import { db } from "@/db";
import { and, desc, eq, gte } from "drizzle-orm";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

export async function insertTask(
  data: typeof tasks.$inferInsert
): Promise<typeof tasks.$inferSelect | undefined> {
  if (data.created_at && typeof data.created_at === "string") {
    data.created_at = new Date(data.created_at);
  }
  if (data.updated_at && typeof data.updated_at === "string") {
    data.updated_at = new Date(data.updated_at);
  }
  if (data.started_at && typeof data.started_at === "string") {
    data.started_at = new Date(data.started_at);
  }
  if (data.completed_at && typeof data.completed_at === "string") {
    data.completed_at = new Date(data.completed_at);
  }

  const [row] = await db().insert(tasks).values(data).returning();
  return row;
}

export async function insertTaskForIdempotencyKey(
  data: typeof tasks.$inferInsert
): Promise<typeof tasks.$inferSelect | undefined> {
  const [row] = await db()
    .insert(tasks)
    .values(data)
    .onConflictDoNothing({
      target: [tasks.user_uuid, tasks.type, tasks.idempotency_key],
    })
    .returning();

  return row;
}

export async function findTaskByUuid(
  uuid: string
): Promise<typeof tasks.$inferSelect | undefined> {
  const [row] = await db()
    .select()
    .from(tasks)
    .where(eq(tasks.uuid, uuid))
    .limit(1);
  return row;
}

export async function findTaskByIdempotencyKey({
  user_uuid,
  type,
  idempotency_key,
}: {
  user_uuid: string;
  type: string;
  idempotency_key: string;
}): Promise<typeof tasks.$inferSelect | undefined> {
  const [row] = await db()
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.user_uuid, user_uuid),
        eq(tasks.type, type),
        eq(tasks.idempotency_key, idempotency_key)
      )
    )
    .limit(1);
  return row;
}

export async function getTasksByUserUuid(
  user_uuid: string,
  page: number = 1,
  limit: number = 50
): Promise<(typeof tasks.$inferSelect)[] | undefined> {
  const data = await db()
    .select()
    .from(tasks)
    .where(eq(tasks.user_uuid, user_uuid))
    .orderBy(desc(tasks.created_at))
    .limit(limit)
    .offset((page - 1) * limit);
  return data;
}

/**
 * How many tasks a user has created since `since`, for plan quota checks.
 *
 * Counts every task regardless of outcome, including failed ones. Counting
 * only successes sounds fairer until you notice it lets a user retry a failing
 * prompt without limit, and each attempt still costs a provider call.
 */
export async function countTasksByUserSince(
  user_uuid: string,
  since: Date
): Promise<number> {
  return db().$count(
    tasks,
    and(eq(tasks.user_uuid, user_uuid), gte(tasks.created_at, since))
  );
}

export async function updateTaskStatus(
  uuid: string,
  status: TaskStatus,
  fields: Partial<typeof tasks.$inferInsert> = {}
): Promise<typeof tasks.$inferSelect | undefined> {
  const [row] = await db()
    .update(tasks)
    .set({
      status,
      updated_at: new Date(),
      ...fields,
    })
    .where(eq(tasks.uuid, uuid))
    .returning();
  return row;
}
