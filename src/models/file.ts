import { db } from "@/db";
import { files } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export async function insertFile(
  data: typeof files.$inferInsert
): Promise<typeof files.$inferSelect | undefined> {
  const [row] = await db().insert(files).values(data).returning();
  return row;
}

export async function findFileByUuid(
  uuid: string
): Promise<typeof files.$inferSelect | undefined> {
  const [row] = await db().select().from(files).where(eq(files.uuid, uuid)).limit(1);
  return row;
}

export async function updateFileByUuid(
  uuid: string,
  patch: Partial<typeof files.$inferInsert>
): Promise<typeof files.$inferSelect | undefined> {
  const [row] = await db()
    .update(files)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(files.uuid, uuid))
    .returning();
  return row;
}

export async function listFilesByUser(
  user_uuid: string,
  page: number = 1,
  limit: number = 50,
  includeDeleted = false
): Promise<(typeof files.$inferSelect)[]> {
  const offset = (page - 1) * limit;

  const where = includeDeleted
    ? eq(files.user_uuid, user_uuid)
    : and(eq(files.user_uuid, user_uuid), eq(files.status, "active"));

  const rows = await db()
    .select()
    .from(files)
    .where(where)
    .orderBy(desc(files.created_at))
    .limit(limit)
    .offset(offset);

  return rows;
}

export async function softDeleteFile(
  uuid: string
): Promise<typeof files.$inferSelect | undefined> {
  const [row] = await db()
    .update(files)
    .set({ status: "deleted", deleted_at: new Date(), updated_at: new Date() })
    .where(eq(files.uuid, uuid))
    .returning();
  return row;
}

export async function countFilesByUser(user_uuid: string): Promise<number> {
  return db().$count(files, eq(files.user_uuid, user_uuid));
}

