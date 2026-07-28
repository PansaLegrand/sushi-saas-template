/**
 * Database tier: the two Better Auth hooks that enforce a ban.
 *
 * Everything else in this change is testable with mocks. This is not. The
 * question here is whether throwing an `APIError` from `databaseHooks` actually
 * stops Better Auth — whether the signup gate and the sign-in gate are wired to
 * the real request paths, or merely to functions that nothing calls.
 *
 * That distinction is the difference between a ban and a UI that says "banned".
 * So this tier drives `auth.api` itself, against a real database, and asserts on
 * what the caller gets back.
 *
 * The alias case is the one worth reading. A blocklist that compares raw input
 * blocks one spelling of an address and an abuser types a second one; the
 * assertion that `blocked+evade@…` is refused is the entire feature working or
 * not working.
 */
import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { describeDb, useCleanDatabase } from "./setup";

import { db } from "@/db";
import { users } from "@/db/schema";
import { addBlocklistEntry, banUserAccount } from "@/services/moderation";

useCleanDatabase();

/**
 * `example.com` is reserved by RFC 2606, so nothing here can reach a real
 * mailbox even if an email provider were configured.
 */
const DOMAIN = "ban-hooks.example.com";
const PASSWORD = "correct-horse-battery-staple-1";

/** Imported lazily: `src/lib/auth.ts` binds the db at module scope, and
 *  `setup.ts` must have redirected DATABASE_URL first. */
async function getAuth() {
  return (await import("@/lib/auth")).auth;
}

/** Better Auth throws an APIError; this pulls out the code the client would see. */
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
      // `uuid` and `role` are declared as `additionalFields` with `input: false`
      // — the server assigns them and strips anything a caller sends — but
      // Better Auth still types them as required on the signup body. The cast is
      // that gap, not a shortcut: passing them would be the misleading version,
      // since the values would be discarded.
      body: { email, password: PASSWORD, name: "Test" } as never,
      headers: new Headers(),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, code: errorCodeOf(e) };
  }
}

async function signIn(email: string): Promise<{ ok: boolean; code?: string }> {
  const auth = await getAuth();
  try {
    await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      headers: new Headers(),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, code: errorCodeOf(e) };
  }
}

/**
 * Signup leaves the account unverified, and `requireEmailVerification` stops
 * sign-in before a session is ever created — which is upstream of the hook
 * under test. Marking the address verified is what lets these tests reach it.
 */
async function markVerified(email: string) {
  await db()
    .update(users)
    .set({ email_verified: true })
    .where(eq(users.email, email));
}

let email: string;

beforeEach(() => {
  // A fresh address per test: `(email, signin_provider)` is unique, so a reused
  // one would collide with the previous test's row rather than exercise the gate.
  email = `abuser-${randomUUID().slice(0, 8)}@${DOMAIN}`;
});

describeDb("signup gate (real auth stack)", () => {
  it("lets an address nothing matches through", async () => {
    // Guards the guard. Without this, every assertion below could be passing
    // because signup is broken rather than because the block works.
    const result = await signUp(email);

    expect(result.code ?? "ok").toBe("ok");
    expect(result.ok).toBe(true);
  });

  it("refuses a blocklisted address", async () => {
    await addBlocklistEntry({
      scope: "email",
      value: email,
      actorUuid: "test",
    });

    const result = await signUp(email);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("ACCOUNT_SIGNUP_BLOCKED");
  });

  it("refuses a plus-alias of a blocklisted address", async () => {
    // The bypass. `abuser+1@`, `abuser+2@` … all deliver to one mailbox, and a
    // literal match blocks exactly none of them.
    await addBlocklistEntry({
      scope: "email",
      value: email,
      actorUuid: "test",
    });

    const result = await signUp(email.replace("@", "+evade@"));

    expect(result.ok).toBe(false);
    expect(result.code).toBe("ACCOUNT_SIGNUP_BLOCKED");
  });

  it("refuses an address it has never seen when the domain is blocked", async () => {
    // One row that ends a flood, instead of chasing addresses one at a time.
    await addBlocklistEntry({
      scope: "domain",
      value: DOMAIN,
      actorUuid: "test",
    });

    const result = await signUp(`never-seen-${randomUUID().slice(0, 8)}@${DOMAIN}`);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("ACCOUNT_SIGNUP_BLOCKED");
  });

  it("writes no user row for a blocked signup", async () => {
    // A hook that rejects *after* the insert would leave the account behind and
    // make the address unusable forever, including by whoever legitimately owns it.
    await addBlocklistEntry({ scope: "domain", value: DOMAIN, actorUuid: "test" });

    await signUp(email);

    const rows = await db().select().from(users).where(eq(users.email, email));
    expect(rows).toEqual([]);
  });
});

/**
 * A *successful* sign-in cannot be asserted here, and the reason is
 * environmental rather than a gap in the gate.
 *
 * Better Auth's `nextCookies()` plugin writes the session cookie through a
 * dynamic `import("next/headers")` from inside its own pre-bundled `.mjs`.
 * Vite externalizes that bundle, so neither `vi.mock` nor a resolver alias
 * reaches the import, and it fails on module resolution outside a Next runtime.
 * A rejected sign-in never gets that far — the ban throws before a session row
 * exists — so the blocked path is fully exercised and the allowed path is not.
 *
 * These therefore assert the *specific* code rather than a bare boolean, which
 * keeps them honest in both directions: an unrelated breakage produces a
 * different code and fails the test rather than masquerading as a ban.
 */
describeDb("sign-in gate (real auth stack)", () => {
  async function seedVerifiedUser() {
    await signUp(email);
    await markVerified(email);

    const [row] = await db().select().from(users).where(eq(users.email, email));
    return row;
  }

  it("refuses a suspended account", async () => {
    const row = await seedVerifiedUser();

    await banUserAccount({
      userUuid: row.uuid,
      reason: "test",
      actorUuid: "admin-test",
      // Off, so this asserts the ban itself rather than the blocklist entry a
      // ban would normally also create.
      blockEmail: false,
    });

    const result = await signIn(email);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("does not refuse an account that was never suspended", async () => {
    // The control for the assertion above: proves ACCOUNT_SUSPENDED comes from
    // the ban and not from every sign-in in this environment.
    await seedVerifiedUser();

    expect((await signIn(email)).code).not.toBe("ACCOUNT_SUSPENDED");
  });

  it("stops refusing once the suspension is lifted", async () => {
    // A ban nobody can undo is a delete with extra steps.
    const { unbanUserAccount } = await import("@/services/moderation");

    const row = await seedVerifiedUser();
    await banUserAccount({
      userUuid: row.uuid,
      reason: "test",
      actorUuid: "admin-test",
      blockEmail: false,
    });
    expect((await signIn(email)).code).toBe("ACCOUNT_SUSPENDED");

    await unbanUserAccount({ userUuid: row.uuid });

    expect((await signIn(email)).code).not.toBe("ACCOUNT_SUSPENDED");
  });

  it("refuses every account on the address, not just the banned row", async () => {
    // The bypass in its end-to-end form: this person holds a password account
    // and a Google account on one address, and banning the row an admin pasted
    // must not leave the other one able to sign in.
    const row = await seedVerifiedUser();

    // The Google row, as Better Auth would have created it on a second signup.
    await db()
      .insert(users)
      .values({
        id: randomUUID(),
        uuid: randomUUID(),
        email,
        signin_provider: "google",
        email_verified: true,
      });

    await banUserAccount({
      userUuid: row.uuid,
      reason: "test",
      actorUuid: "admin-test",
      blockEmail: false,
    });

    const rows = await db().select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(2);
    expect(rows.every((user) => user.banned_at !== null)).toBe(true);
  });
});
