/**
 * Database tier: duplicate signup handling.
 *
 * Better Auth returns a synthetic success for existing emails when email
 * verification is required. That protects against account enumeration, but in
 * this app it made the UI say "Account created" even when no row was written
 * and, for verified accounts, no verification email was sent. The app-level
 * guard must reject the second signup before that synthetic response reaches
 * the client.
 */
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { accounts, users } from "@/db/schema";

useCleanDatabase();

const DOMAIN = "signup-duplicates.example.com";
const PASSWORD = "correct-horse-battery-staple-1";

async function getAuth() {
  return (await import("@/lib/auth")).auth;
}

function errorCodeOf(e: unknown): string {
  const err = e as {
    body?: { code?: string; message?: string };
    status?: string;
  };
  return err.body?.code ?? err.body?.message ?? String(err.status ?? e);
}

async function signUp(email: string): Promise<{ ok: boolean; code?: string }> {
  const auth = await getAuth();
  try {
    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "Test" } as never,
      headers: new Headers(),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, code: errorCodeOf(e) };
  }
}

async function seedGoogleUser(email: string): Promise<string> {
  const id = randomUUID();

  await db()
    .insert(users)
    .values({
      id,
      uuid: randomUUID(),
      email,
      signin_provider: "google",
      signin_type: "oauth",
      email_verified: true,
    });

  await db()
    .insert(accounts)
    .values({
      id: randomUUID(),
      user_id: id,
      account_id: `google-${id}`,
      provider_id: "google",
    });

  return id;
}

describeDb("duplicate signup guard (real auth stack)", () => {
  it("rejects a repeated email/password signup", async () => {
    const email = `credential-${randomUUID().slice(0, 8)}@${DOMAIN}`;

    expect(await signUp(email)).toEqual({ ok: true });

    const second = await signUp(email);

    expect(second).toEqual({ ok: false, code: "AUTH_USER_ALREADY_EXISTS" });

    const userRows = await db().select().from(users).where(eq(users.email, email));
    const accountRows = await db()
      .select()
      .from(accounts)
      .where(eq(accounts.provider_id, "credential"));

    expect(userRows).toHaveLength(1);
    expect(accountRows.filter((row) => row.user_id === userRows[0].id)).toHaveLength(1);
  });

  it("rejects email/password signup for an address first claimed by Google", async () => {
    const email = `google-${randomUUID().slice(0, 8)}@${DOMAIN}`;
    const googleUserId = await seedGoogleUser(email);

    const result = await signUp(email);

    expect(result).toEqual({ ok: false, code: "AUTH_USER_ALREADY_EXISTS" });

    const userRows = await db().select().from(users).where(eq(users.email, email));
    const accountRows = await db()
      .select()
      .from(accounts)
      .where(eq(accounts.user_id, googleUserId));

    expect(userRows).toHaveLength(1);
    expect(accountRows.map((row) => row.provider_id)).toEqual(["google"]);
  });
});
