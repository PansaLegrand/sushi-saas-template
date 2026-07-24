import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db";
import { authEvents } from "@/db/schema";

export type AuthEventName = "signup" | "signin" | "email_verified";

export interface InsertAuthEventParams {
  user_uuid?: string;
  user_id?: string;
  email?: string;
  event: AuthEventName;
  provider?: string;
  ip_address?: string | null;
  user_agent?: string | null;
  metadata?: unknown;
}

function truncate(value: string | null | undefined, max: number) {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export async function insertAuthEvent(
  params: InsertAuthEventParams
): Promise<void> {
  await db()
    .insert(authEvents)
    .values({
      uuid: randomUUID(),
      user_uuid: params.user_uuid ?? "",
      user_id: params.user_id ?? "",
      email: params.email ?? "",
      event: params.event,
      provider: params.provider ?? "",
      ip_address: truncate(params.ip_address, 255),
      user_agent: truncate(params.user_agent, 1024),
      metadata_json:
        params.metadata === undefined ? null : JSON.stringify(params.metadata),
    });
}

export async function listAuthEventsByUser(
  user_uuid: string,
  limit: number = 50
) {
  return db()
    .select()
    .from(authEvents)
    .where(eq(authEvents.user_uuid, user_uuid))
    .orderBy(desc(authEvents.created_at))
    .limit(limit);
}

export async function listAuthEvents(page: number = 1, limit: number = 50) {
  return db()
    .select()
    .from(authEvents)
    .orderBy(desc(authEvents.created_at))
    .limit(limit)
    .offset((page - 1) * limit);
}

export async function countAuthEvents(): Promise<number> {
  return db().$count(authEvents);
}

/**
 * Distinct users per day for an event, e.g. daily active users from `signin`.
 */
export async function countDistinctUsersByDay(
  event: AuthEventName,
  since: Date
): Promise<{ day: string; users: number }[]> {
  const rows = await db()
    .select({
      day: sql<string>`to_char(${authEvents.created_at}, 'YYYY-MM-DD')`,
      users: sql<number>`count(distinct ${authEvents.user_uuid})::int`,
    })
    .from(authEvents)
    .where(and(eq(authEvents.event, event), gte(authEvents.created_at, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  return rows;
}

/**
 * Sign-in counts per user, highest first — the "who logs in most" query.
 */
export async function countEventsByUser(
  event: AuthEventName,
  since: Date,
  limit: number = 50
): Promise<{ user_uuid: string; events: number }[]> {
  return db()
    .select({
      user_uuid: authEvents.user_uuid,
      events: sql<number>`count(*)::int`,
    })
    .from(authEvents)
    .where(and(eq(authEvents.event, event), gte(authEvents.created_at, since)))
    .groupBy(authEvents.user_uuid)
    .orderBy(sql`count(*) desc`)
    .limit(limit);
}
