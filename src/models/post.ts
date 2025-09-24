import { posts } from "@/db/schema";
import { db } from "@/db";
import { and, desc, eq } from "drizzle-orm";

export enum PostStatus {
  Created = "created",
  Deleted = "deleted",
  Online = "online",
  Offline = "offline",
}

export async function insertPost(
  data: typeof posts.$inferInsert
): Promise<typeof posts.$inferSelect | undefined> {
  const [post] = await db().insert(posts).values(data).returning();

  return post;
}

export async function updatePost(
  uuid: string,
  data: Partial<typeof posts.$inferInsert>
): Promise<typeof posts.$inferSelect | undefined> {
  const [post] = await db()
    .update(posts)
    .set(data)
    .where(eq(posts.uuid, uuid))
    .returning();

  return post;
}

export async function findPostByUuid(
  uuid: string
): Promise<typeof posts.$inferSelect | undefined> {
  const [post] = await db()
    .select()
    .from(posts)
    .where(eq(posts.uuid, uuid))
    .limit(1);

  return post;
}

export async function findPostBySlug(
  slug: string,
  locale: string
): Promise<typeof posts.$inferSelect | undefined> {
  const [post] = await db()
    .select()
    .from(posts)
    .where(and(eq(posts.slug, slug), eq(posts.locale, locale)))
    .limit(1);

  return post;
}

export async function getAllPosts(
  page: number = 1,
  limit: number = 50
): Promise<(typeof posts.$inferSelect)[] | undefined> {
  const offset = (page - 1) * limit;

  const data = await db()
    .select()
    .from(posts)
    .orderBy(desc(posts.created_at))
    .limit(limit)
    .offset(offset);

  return data;
}

export async function getPostsByLocale(
  locale: string,
  page: number = 1,
  limit: number = 50
): Promise<(typeof posts.$inferSelect)[] | undefined> {
  const offset = (page - 1) * limit;

  const data = await db()
    .select()
    .from(posts)
    .where(and(eq(posts.locale, locale), eq(posts.status, PostStatus.Online)))
    .orderBy(desc(posts.created_at))
    .limit(limit)
    .offset(offset);

  return data;
}

export async function getPostsTotal(): Promise<number> {
  const total = await db().$count(posts);

  return total;
}
