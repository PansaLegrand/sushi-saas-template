import { apikeys } from "@/db/schema";
import { db } from "@/db";
import { and, eq, ne } from "drizzle-orm";
import { desc } from "drizzle-orm";

import { scopedToOrg } from "./organization";

export enum ApikeyStatus {
  Created = "created",
  Deleted = "deleted",
}

/** `org_uuid` is required: a key that authenticates into no tenant is unusable. */
export type ApikeyInsert = typeof apikeys.$inferInsert & { org_uuid: string };

export async function insertApikey(
  data: ApikeyInsert
): Promise<typeof apikeys.$inferSelect | undefined> {
  const [apikey] = await db().insert(apikeys).values(data).returning();

  return apikey;
}

export async function getOrgApikeys(
  orgUuid: string,
  page: number = 1,
  limit: number = 50
): Promise<(typeof apikeys.$inferSelect)[] | undefined> {
  const offset = (page - 1) * limit;

  const data = await db()
    .select()
    .from(apikeys)
    .where(
      and(
        scopedToOrg(apikeys.org_uuid, orgUuid),
        ne(apikeys.status, ApikeyStatus.Deleted)
      )
    )
    .orderBy(desc(apikeys.created_at))
    .limit(limit)
    .offset(offset);

  return data;
}

/**
 * Resolve the tenant and actor behind a presented API key.
 *
 * Necessarily unscoped: this is the call that *establishes* the scope, the same
 * way a session cookie does. Everything downstream of it must use the returned
 * `org_uuid` rather than deriving one from the request.
 */
export async function findApikeyContext(
  apiKey: string
): Promise<{ user_uuid: string; org_uuid: string | null } | undefined> {
  const [apikey] = await db()
    .select({ user_uuid: apikeys.user_uuid, org_uuid: apikeys.org_uuid })
    .from(apikeys)
    .where(
      and(eq(apikeys.api_key, apiKey), eq(apikeys.status, ApikeyStatus.Created))
    )
    .limit(1);

  return apikey;
}
