import {
  and,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  type SQL,
} from "drizzle-orm";

import { db } from "@/db";
import { emailBlocklist } from "@/db/schema";

/**
 * The signup blocklist.
 *
 * Global by design, and one of the few tables here that is: an address is
 * blocked from the product, not from a tenant. A per-org blocklist would let a
 * banned address sign up again by landing in a different workspace, which is
 * the hole this exists to close.
 *
 * Callers must pass values that are already normalized — see
 * `src/lib/email-address.ts`. Normalizing inside the model would put the same
 * rule in two places and let one of them drift.
 */

export type EmailBlocklistRow = typeof emailBlocklist.$inferSelect;
export type EmailBlocklistScope = "email" | "domain";

/** Live entries only: an expired row stays for the trail but stops matching. */
function unexpired(now: Date) {
  return or(
    isNull(emailBlocklist.expires_at),
    gt(emailBlocklist.expires_at, now)
  );
}

export async function insertBlocklistEntry(
  data: typeof emailBlocklist.$inferInsert
): Promise<EmailBlocklistRow | undefined> {
  const [row] = await db().insert(emailBlocklist).values(data).returning();
  return row;
}

/**
 * Every live rule that matches an address.
 *
 * Both keys go in one round trip because this runs on the signup path, where a
 * second sequential query is latency every legitimate user pays to catch the
 * rare blocked one.
 *
 * Returns all matches rather than the first: an address can be covered by its
 * own rule *and* by a rule on its domain, and an admin lifting one needs to see
 * that the other is still standing. The signup gate itself only cares that the
 * list is non-empty, but it reports which rule fired — "blocked by domain" and
 * "blocked by address" are different operational facts, and a gate that cannot
 * tell them apart is one nobody can tune.
 */
export async function findActiveBlocklistMatches(params: {
  normalizedEmail: string | null;
  normalizedDomain: string | null;
  now?: Date;
}): Promise<EmailBlocklistRow[]> {
  const candidates: string[] = [];
  if (params.normalizedEmail) candidates.push(params.normalizedEmail);
  if (params.normalizedDomain) candidates.push(params.normalizedDomain);
  if (candidates.length === 0) return [];

  const now = params.now ?? new Date();

  const rows = await db()
    .select()
    .from(emailBlocklist)
    .where(and(inArray(emailBlocklist.value, candidates), unexpired(now)));

  // The `value` filter above cannot tell scopes apart, so a row is only a real
  // match when its scope agrees with the key it matched. In practice a host and
  // an address can never be spelled the same — an address contains `@` — but
  // relying on that would make the query silently wrong if the scopes ever grow.
  return rows.filter(
    (row) =>
      (row.scope === "email" && row.value === params.normalizedEmail) ||
      (row.scope === "domain" && row.value === params.normalizedDomain)
  );
}

export async function findBlocklistEntry(
  scope: EmailBlocklistScope,
  value: string
): Promise<EmailBlocklistRow | undefined> {
  const [row] = await db()
    .select()
    .from(emailBlocklist)
    .where(and(eq(emailBlocklist.scope, scope), eq(emailBlocklist.value, value)))
    .limit(1);

  return row;
}

/**
 * A blocklist search, assembled by the caller.
 *
 * Split into two parts because a rule is stored under a key that usually is not
 * what anyone typed: `keys` are exact, already-normalized values, and `text` is
 * matched as a substring against both the key and the original input. The
 * normalizing itself stays in the service — see this file's header.
 */
export interface BlocklistSearch {
  text: string;
  keys: string[];
}

function searchFilter(search?: BlocklistSearch): SQL | undefined {
  if (!search) return undefined;

  const like = `%${search.text}%`;
  const clauses: SQL[] = [
    ilike(emailBlocklist.value, like),
    ilike(emailBlocklist.original_value, like),
  ];

  if (search.keys.length > 0) {
    clauses.push(inArray(emailBlocklist.value, search.keys));
  }

  // `or` is only undefined for an empty list, and there are always two clauses.
  return or(...clauses)!;
}

export async function listBlocklistEntries(
  page: number = 1,
  limit: number = 50,
  search?: BlocklistSearch
): Promise<EmailBlocklistRow[]> {
  const offset = (page - 1) * limit;

  return db()
    .select()
    .from(emailBlocklist)
    .where(searchFilter(search))
    .orderBy(desc(emailBlocklist.created_at))
    .limit(limit)
    .offset(offset);
}

export async function countBlocklistEntries(
  search?: BlocklistSearch
): Promise<number> {
  return db().$count(emailBlocklist, searchFilter(search));
}

/**
 * Hard delete, not a soft one.
 *
 * The audit trail already records who added the entry and who lifted it, so a
 * tombstone here would add a second history that can disagree with the first —
 * and a blocklist that keeps rows it no longer enforces is one an operator has
 * to read twice to answer "is this address blocked".
 */
export async function deleteBlocklistEntryByUuid(
  uuid: string
): Promise<EmailBlocklistRow | undefined> {
  const [row] = await db()
    .delete(emailBlocklist)
    .where(eq(emailBlocklist.uuid, uuid))
    .returning();

  return row;
}

export async function deleteBlocklistEntry(
  scope: EmailBlocklistScope,
  value: string
): Promise<EmailBlocklistRow | undefined> {
  const [row] = await db()
    .delete(emailBlocklist)
    .where(and(eq(emailBlocklist.scope, scope), eq(emailBlocklist.value, value)))
    .returning();

  return row;
}
