import { tasks } from "@/db/schema";
import { db } from "@/db";
import { and, desc, eq, gte } from "drizzle-orm";

import { scopedToOrg } from "./organization";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

/** `org_uuid` is required: an unscoped task is invisible to every read below. */
export type TaskInsert = typeof tasks.$inferInsert & { org_uuid: string };

export async function insertTask(
  data: TaskInsert
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

/**
 * Idempotency stays keyed on the *user*, not the organization.
 *
 * The key identifies one caller's retry of one request. Widening it to the org
 * would make two members submitting the same prompt collide with each other,
 * which is a different and much more surprising behaviour than the one this
 * index exists to provide.
 */
export async function insertTaskForIdempotencyKey(
  data: TaskInsert
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
  uuid: string,
  orgUuid: string
): Promise<typeof tasks.$inferSelect | undefined> {
  const [row] = await db()
    .select()
    .from(tasks)
    .where(and(eq(tasks.uuid, uuid), scopedToOrg(tasks.org_uuid, orgUuid)))
    .limit(1);
  return row;
}

export async function findTaskByIdempotencyKey({
  user_uuid,
  org_uuid,
  type,
  idempotency_key,
}: {
  user_uuid: string;
  org_uuid: string;
  type: string;
  idempotency_key: string;
}): Promise<typeof tasks.$inferSelect | undefined> {
  const [row] = await db()
    .select()
    .from(tasks)
    .where(
      and(
        scopedToOrg(tasks.org_uuid, org_uuid),
        eq(tasks.user_uuid, user_uuid),
        eq(tasks.type, type),
        eq(tasks.idempotency_key, idempotency_key)
      )
    )
    .limit(1);
  return row;
}

export async function getTasksByOrg(
  orgUuid: string,
  page: number = 1,
  limit: number = 50
): Promise<(typeof tasks.$inferSelect)[] | undefined> {
  const data = await db()
    .select()
    .from(tasks)
    .where(scopedToOrg(tasks.org_uuid, orgUuid))
    .orderBy(desc(tasks.created_at))
    .limit(limit)
    .offset((page - 1) * limit);
  return data;
}

/**
 * How many tasks an organization has created since `since`, for plan quotas.
 *
 * Counts every task regardless of outcome, including failed ones. Counting only
 * successes sounds fairer until you notice it lets a caller retry a failing
 * prompt without limit, and each attempt still costs a provider call.
 *
 * Org-wide rather than per-user because the plan is bought by the org: five
 * members should share one monthly allowance, not get five.
 */
export async function countTasksByOrgSince(
  orgUuid: string,
  since: Date
): Promise<number> {
  return db().$count(
    tasks,
    and(scopedToOrg(tasks.org_uuid, orgUuid), gte(tasks.created_at, since))
  );
}

export async function updateTaskStatus(
  uuid: string,
  orgUuid: string,
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
    .where(and(eq(tasks.uuid, uuid), scopedToOrg(tasks.org_uuid, orgUuid)))
    .returning();
  return row;
}
