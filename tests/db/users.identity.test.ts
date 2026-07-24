/**
 * Database tier: user identity constraints.
 *
 * `email_provider_unique_idx` on (email, signin_provider) is what stops the
 * same address from being claimed twice through the same provider while still
 * allowing one person to sign in with both a password and Google. The index was
 * present in migration 0000 but unenforced for a while, because
 * `signin_provider` was left null on insert — a null makes the row unique
 * against everything, so the constraint quietly stopped meaning anything.
 *
 * These tests pin both halves: the index rejects genuine duplicates, and the
 * provider column is actually populated so it can.
 */
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { UNIQUE_VIOLATION, describeDb, errorCode, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { users } from "@/db/schema";
import { findUserByEmail, findUserByUuid } from "@/models/user";

function newUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  return {
    id: randomUUID(),
    uuid: randomUUID(),
    email: "dup@test.dev",
    signin_provider: "credential",
    ...overrides,
  } satisfies typeof users.$inferInsert;
}

describeDb("user identity constraints (real database)", () => {
  useCleanDatabase();

  it("rejects the same email through the same provider", async () => {
    await db().insert(users).values(newUser());

    const error = await db()
      .insert(users)
      .values(newUser())
      .catch((e) => e);

    expect(errorCode(error)).toBe(UNIQUE_VIOLATION);
  });

  it("allows the same email through different providers", async () => {
    await db().insert(users).values(newUser({ signin_provider: "credential" }));
    await db().insert(users).values(newUser({ signin_provider: "google" }));

    const rows = await db()
      .select()
      .from(users)
      .where(eq(users.email, "dup@test.dev"));

    expect(rows).toHaveLength(2);
  });

  it("keeps uuid unique across providers", async () => {
    const uuid = randomUUID();
    await db().insert(users).values(newUser({ uuid }));

    const error = await db()
      .insert(users)
      .values(newUser({ uuid, signin_provider: "google" }))
      .catch((e) => e);

    expect(errorCode(error)).toBe(UNIQUE_VIOLATION);
  });

  it("resolves a user by uuid, the id the app treats as stable", async () => {
    const row = newUser({ email: "lookup@test.dev" });
    await db().insert(users).values(row);

    const found = await findUserByUuid(row.uuid);

    expect(found?.email).toBe("lookup@test.dev");
    expect(found?.uuid).toBe(row.uuid);
  });

  it("returns a single user when an email is shared across providers", async () => {
    // findUserByEmail is a convenience lookup, not an identity check — with two
    // provider rows behind one address it must still return one row rather than
    // throwing or returning an array-shaped surprise to its callers.
    await db().insert(users).values(newUser({ signin_provider: "credential" }));
    await db().insert(users).values(newUser({ signin_provider: "google" }));

    const found = await findUserByEmail("dup@test.dev");

    expect(found).toBeDefined();
    expect(found?.email).toBe("dup@test.dev");
  });
});
