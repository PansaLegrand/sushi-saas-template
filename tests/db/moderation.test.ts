/**
 * Database tier: suspension and the signup blocklist.
 *
 * These assert what the schema actually does rather than what the service
 * believes it does. Three of them exist because the alternative is a ban that
 * looks applied in the console and does nothing in practice:
 *
 * - a re-ban must not overwrite the first ban's record, which is a `WHERE` on
 *   the UPDATE and nothing in TypeScript can enforce it;
 * - one address can hold several accounts, so a ban that touched one row would
 *   be walked around by clicking a different sign-in button;
 * - a duplicate blocklist rule must be rejected by the index, not by the
 *   application remembering to check first.
 */
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { UNIQUE_VIOLATION, describeDb, errorCode, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { emailBlocklist, sessions, users } from "@/db/schema";
import {
  findUsersByEmail,
  findUserByUuid,
  markUserBanned,
  markUserUnbanned,
} from "@/models/user";
import { countAdminBannedUsers } from "@admin/lib/data";
import {
  countSessionsByUserId,
  deleteSessionsByUserId,
} from "@/models/session";
import {
  findActiveBlocklistMatches,
  insertBlocklistEntry,
  type EmailBlocklistRow,
} from "@/models/email-blocklist";
import { listBlocklist } from "@/services/moderation";

// File-level, not per-suite: `useCleanDatabase()` registers the afterAll that
// closes the connection, so calling it inside each describe would end the pool
// when the first suite finished and leave the second one unable to query.
useCleanDatabase();

const ABUSER_EMAIL = "abuser@test.dev";

async function seedUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const row = {
    id: randomUUID(),
    uuid: randomUUID(),
    email: ABUSER_EMAIL,
    signin_provider: "credential",
    ...overrides,
  } satisfies typeof users.$inferInsert;

  await db().insert(users).values(row);
  return row;
}

async function seedSession(userId: string) {
  await db()
    .insert(sessions)
    .values({
      id: randomUUID(),
      user_id: userId,
      token: randomUUID(),
      expires_at: new Date(Date.now() + 86_400_000),
    });
}

describeDb("account suspension (real database)", () => {
  it("records who banned, when, and why", async () => {
    const user = await seedUser();

    await markUserBanned({
      user_uuid: user.uuid,
      reason: "signup flood",
      banned_by: "admin-1",
    });

    const banned = await findUserByUuid(user.uuid);
    expect(banned?.banned_at).toBeInstanceOf(Date);
    expect(banned?.ban_reason).toBe("signup flood");
    expect(banned?.banned_by).toBe("admin-1");
  });

  it("keeps the first ban's record when banned again", async () => {
    // The `WHERE banned_at IS NULL` on the UPDATE. Without it, re-banning
    // during an incident replaces "banned an hour ago for spam" — the fact
    // worth having — with "banned just now for see above".
    const user = await seedUser();

    await markUserBanned({
      user_uuid: user.uuid,
      reason: "original reason",
      banned_by: "admin-1",
    });
    const first = await findUserByUuid(user.uuid);

    const second = await markUserBanned({
      user_uuid: user.uuid,
      reason: "different reason",
      banned_by: "admin-2",
    });

    // Undefined is how the caller learns nothing changed.
    expect(second).toBeUndefined();

    const after = await findUserByUuid(user.uuid);
    expect(after?.ban_reason).toBe("original reason");
    expect(after?.banned_by).toBe("admin-1");
    expect(after?.banned_at?.toISOString()).toBe(first?.banned_at?.toISOString());
  });

  it("clears the record on unban and reports the no-op", async () => {
    const user = await seedUser();
    await markUserBanned({
      user_uuid: user.uuid,
      reason: "spam",
      banned_by: "admin-1",
    });

    expect(await markUserUnbanned(user.uuid)).toBeDefined();

    const after = await findUserByUuid(user.uuid);
    expect(after?.banned_at).toBeNull();
    expect(after?.ban_reason).toBeNull();
    expect(after?.banned_by).toBe("");

    // Unbanning an active account changed nothing, and says so.
    expect(await markUserUnbanned(user.uuid)).toBeUndefined();
  });

  it("finds every account sharing an address", async () => {
    // The reason a ban is not a single-row update: `email` is unique only per
    // provider, so this person has two accounts and banning one leaves the
    // other open.
    await seedUser({ signin_provider: "credential" });
    await seedUser({ signin_provider: "google" });

    const accounts = await findUsersByEmail(ABUSER_EMAIL);
    expect(accounts).toHaveLength(2);
  });

  it("counts only suspended accounts", async () => {
    const banned = await seedUser({ signin_provider: "credential" });
    await seedUser({ signin_provider: "google" });

    await markUserBanned({
      user_uuid: banned.uuid,
      reason: null,
      banned_by: "admin-1",
    });

    expect(await countAdminBannedUsers()).toBe(1);
  });

  it("revokes every live session for one account and no others", async () => {
    // What makes a ban immediate. Session validity is a row lookup on each
    // request, so deleting the rows ends access now rather than at expiry.
    const target = await seedUser({ signin_provider: "credential" });
    const bystander = await seedUser({
      email: "someone@test.dev",
      signin_provider: "credential",
    });

    await seedSession(target.id);
    await seedSession(target.id);
    await seedSession(bystander.id);

    expect(await deleteSessionsByUserId(target.id)).toBe(2);
    expect(await countSessionsByUserId(target.id)).toBe(0);
    expect(await countSessionsByUserId(bystander.id)).toBe(1);
  });
});

describeDb("signup blocklist (real database)", () => {
  async function seedRule(
    overrides: Partial<typeof emailBlocklist.$inferInsert> = {}
  ) {
    return insertBlocklistEntry({
      uuid: randomUUID(),
      scope: "email",
      value: "abuser@test.dev",
      original_value: "Abuser+1@Test.dev",
      created_by: "admin-1",
      ...overrides,
    });
  }

  it("rejects a duplicate rule at the index, not in application code", async () => {
    // Re-blocking must be a no-op. Two rows for one rule means deleting it
    // twice before the block actually lifts, which is how an address stays
    // blocked after an admin is certain they unblocked it.
    await seedRule();

    const error = await seedRule({ uuid: randomUUID() }).catch((e) => e);

    expect(errorCode(error)).toBe(UNIQUE_VIOLATION);
  });

  it("allows the same value under a different scope", async () => {
    await seedRule({ scope: "email", value: "example.com" });
    await seedRule({ uuid: randomUUID(), scope: "domain", value: "example.com" });

    const rows = await db()
      .select()
      .from(emailBlocklist)
      .where(eq(emailBlocklist.value, "example.com"));

    expect(rows).toHaveLength(2);
  });

  it("matches an address rule", async () => {
    await seedRule();

    const matches = await findActiveBlocklistMatches({
      normalizedEmail: "abuser@test.dev",
      normalizedDomain: "test.dev",
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].scope).toBe("email");
  });

  it("matches a domain rule for an address it has never seen", async () => {
    // The row that ends a signup flood: one entry for a disposable-mail host
    // beats four thousand address entries added one at a time.
    await seedRule({ scope: "domain", value: "test.dev" });

    const matches = await findActiveBlocklistMatches({
      normalizedEmail: "brand-new@test.dev",
      normalizedDomain: "test.dev",
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].scope).toBe("domain");
  });

  it("returns both rules when an address is covered twice", async () => {
    // So that lifting one does not read as lifting the block.
    await seedRule();
    await seedRule({ uuid: randomUUID(), scope: "domain", value: "test.dev" });

    const matches = await findActiveBlocklistMatches({
      normalizedEmail: "abuser@test.dev",
      normalizedDomain: "test.dev",
    });

    expect(matches).toHaveLength(2);
  });

  it("never matches a scope against the wrong key", async () => {
    // A domain rule must not fire because some address happens to equal it.
    await seedRule({ scope: "domain", value: "test.dev" });

    const matches = await findActiveBlocklistMatches({
      normalizedEmail: "test.dev",
      normalizedDomain: null,
    });

    expect(matches).toEqual([]);
  });

  it("stops enforcing an expired rule but keeps the row", async () => {
    await seedRule({ expires_at: new Date(Date.now() - 60_000) });

    const matches = await findActiveBlocklistMatches({
      normalizedEmail: "abuser@test.dev",
      normalizedDomain: "test.dev",
    });

    expect(matches).toEqual([]);
    // The trail survives the enforcement, so "was this ever blocked" stays
    // answerable.
    expect(await db().$count(emailBlocklist)).toBe(1);
  });

  it("still enforces a rule whose expiry is in the future", async () => {
    await seedRule({ expires_at: new Date(Date.now() + 60_000) });

    const matches = await findActiveBlocklistMatches({
      normalizedEmail: "abuser@test.dev",
      normalizedDomain: "test.dev",
    });

    expect(matches).toHaveLength(1);
  });
});

/**
 * The console's "is this address blocked?" box.
 *
 * Every case here is one where a plain substring search returns nothing and the
 * operator concludes the address is free to register. It is not — the rule is
 * stored under its normalized key, which is the whole reason normalization
 * exists. Asserted against real SQL because the search is an `ilike`, an
 * `inArray`, and a filter shared with a `count`.
 */
describeDb("blocklist search (real database)", () => {
  async function seedRule(overrides: Partial<EmailBlocklistRow> = {}) {
    return insertBlocklistEntry({
      uuid: randomUUID(),
      scope: "email",
      value: "abuser@gmail.com",
      original_value: "Ab.User+signup@gmail.com",
      created_by: "admin-1",
      ...overrides,
    });
  }

  it("finds a rule from the address exactly as a signup log printed it", async () => {
    // Stored as `abuser@gmail.com`; typed as the dotted, plus-suffixed form.
    // Substring matching alone answers "not blocked" here, which is wrong.
    await seedRule();

    const { items, total } = await listBlocklist(1, 50, "ab.user+other@gmail.com");

    expect(items.map((e) => e.value)).toEqual(["abuser@gmail.com"]);
    expect(total).toBe(1);
  });

  it("surfaces a domain rule when asked about one address at that domain", async () => {
    // The rule an operator would never think to search for, and the one that is
    // actually stopping the signup they are investigating.
    await seedRule({ scope: "domain", value: "spam.example", original_value: "spam.example" });

    const { items } = await listBlocklist(1, 50, "someone@spam.example");

    expect(items.map((e) => e.scope)).toEqual(["domain"]);
  });

  it("still matches on what was typed when the rule was added", async () => {
    await seedRule();

    const { items } = await listBlocklist(1, 50, "Ab.User+signup");

    expect(items).toHaveLength(1);
  });

  it("matches a partial domain as a substring", async () => {
    await seedRule({ value: "abuser@corp.example", original_value: "abuser@corp.example" });

    const { items } = await listBlocklist(1, 50, "corp.exam");

    expect(items).toHaveLength(1);
  });

  it("reports nothing for an address no rule covers", async () => {
    // The negative answer has to be trustworthy: it is what an admin acts on
    // when they decide an account is legitimate.
    await seedRule();

    const { items, total } = await listBlocklist(1, 50, "innocent@other.example");

    expect(items).toEqual([]);
    expect(total).toBe(0);
  });

  it("counts through the same filter the rows came from", async () => {
    await seedRule({ value: "a@corp.example", original_value: "a@corp.example" });
    await seedRule({
      uuid: randomUUID(),
      value: "b@corp.example",
      original_value: "b@corp.example",
    });
    await seedRule({
      uuid: randomUUID(),
      value: "c@other.example",
      original_value: "c@other.example",
    });

    expect((await listBlocklist(1, 50, "corp.example")).total).toBe(2);
    expect((await listBlocklist(1, 50)).total).toBe(3);
  });

  it("treats a blank search as no filter", async () => {
    await seedRule();

    expect((await listBlocklist(1, 50, "   ")).total).toBe(1);
  });
});
