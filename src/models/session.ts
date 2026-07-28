import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sessions } from "@/db/schema";

/**
 * Live sessions.
 *
 * Better Auth owns this table and every ordinary read and write to it. The one
 * thing it does not give us is the operation below: ending someone's access
 * right now, from the server, without their cooperation.
 */

/**
 * Revoke every session a user holds. Returns how many were killed.
 *
 * This is what makes a ban take effect immediately instead of whenever the
 * cookie happens to expire. Session validity is a row lookup on every request
 * and no session cache is configured, so deleting the rows logs the account out
 * of every device on its next request — which for an active abuser is the same
 * instant.
 *
 * Deleting sessions alone is not a ban: nothing stops them signing straight back
 * in. It is half of the pair, and `banUserAccount()` in `src/services/moderation.ts`
 * owns both halves. Do not call this on its own expecting access to stay closed.
 */
export async function deleteSessionsByUserId(userId: string): Promise<number> {
  const rows = await db()
    .delete(sessions)
    .where(eq(sessions.user_id, userId))
    .returning({ id: sessions.id });

  return rows.length;
}

export async function countSessionsByUserId(userId: string): Promise<number> {
  return db().$count(sessions, eq(sessions.user_id, userId));
}
