import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { accounts } from "@/db/schema";

/**
 * Provider linkage: which ways a user can sign in.
 *
 * Better Auth owns every write here. This model exists for one read it does not
 * expose — whether an account has a password at all — which the UI needs before
 * it can decide whether asking for one is a sensible question.
 *
 * A user who signed up through Google has no `credential` row. Prompting them
 * for their password is a dead end no input can satisfy, and Better Auth
 * reports it as `INVALID_PASSWORD`, which reads as "you typed it wrong" rather
 * than "there is nothing to type".
 */

/**
 * Does this user have a password set?
 *
 * `password IS NOT NULL` as well as `provider_id = 'credential'`: an account row
 * can exist without a hash, and treating that as "has a password" would put the
 * user right back at the dead end this is here to detect.
 */
export async function hasPasswordCredential(userId: string): Promise<boolean> {
  const count = await db().$count(
    accounts,
    and(
      eq(accounts.user_id, userId),
      eq(accounts.provider_id, "credential"),
      isNotNull(accounts.password)
    )
  );

  return count > 0;
}

/** Sign-in providers linked to this account, e.g. `["google"]`. */
export async function listAccountProviders(userId: string): Promise<string[]> {
  const rows = await db()
    .select({ provider_id: accounts.provider_id })
    .from(accounts)
    .where(eq(accounts.user_id, userId));

  return Array.from(new Set(rows.map((row) => row.provider_id)));
}
