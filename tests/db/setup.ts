/**
 * Harness for the database tier.
 *
 * These tests run real SQL against a real Postgres. They exist because the
 * invariants they cover are enforced by the database, not by application code:
 * unique indexes, `FOR UPDATE SKIP LOCKED`, transaction behaviour. A mocked
 * model layer asserts what we *believe* the schema does; this tier asserts what
 * it actually does.
 *
 * Opt-in by design. Without `TEST_DATABASE_URL` the whole tier skips, so
 * `pnpm test:run` stays a one-second, zero-dependency command.
 *
 *   createdb sushi_test
 *   TEST_DATABASE_URL=postgresql://localhost:5432/sushi_test pnpm test:db
 */
import { afterAll, beforeAll, beforeEach, describe } from "vitest";
import { sql } from "drizzle-orm";
import postgres from "postgres";

const rawUrl = process.env.TEST_DATABASE_URL?.trim();

/**
 * Every test here truncates tables. Requiring "test" in the database name is a
 * blunt guard, but it is the one that survives a copy-pasted connection string
 * from a hosting dashboard — which is exactly how someone would wipe a real
 * database with this file.
 */
function assertDisposable(connectionString: string): void {
  let name: string;
  try {
    name = new URL(connectionString).pathname.replace(/^\//, "");
  } catch {
    throw new Error(
      `TEST_DATABASE_URL is not a valid connection URL: ${connectionString}`
    );
  }

  if (!name) {
    throw new Error("TEST_DATABASE_URL must name a database, e.g. .../sushi_test");
  }

  if (!name.toLowerCase().includes("test")) {
    throw new Error(
      `Refusing to run destructive tests against database "${name}". ` +
        `The database tier truncates tables on every test, so TEST_DATABASE_URL ` +
        `must point at a throwaway database whose name contains "test".`
    );
  }
}

export const hasTestDatabase = Boolean(rawUrl);

// Skipping is a local convenience, never a CI outcome. Without this, dropping
// TEST_DATABASE_URL from the workflow would turn the whole tier into a silent
// green — the failure mode where coverage disappears and nobody notices.
if (!hasTestDatabase && process.env.CI) {
  throw new Error(
    "TEST_DATABASE_URL is not set in CI. The database tier must not be skipped " +
      "on CI — check the postgres service and env block in .github/workflows/ci.yml."
  );
}

if (rawUrl) {
  assertDisposable(rawUrl);
  // `db()` reads DATABASE_URL lazily on first call, so overriding it here — at
  // module scope, before any test body runs — is enough to redirect the app's
  // own connection helper at the throwaway database.
  process.env.DATABASE_URL = rawUrl;
}

/**
 * Use in place of `describe` for database tests. Skips cleanly rather than
 * failing when no test database is configured.
 */
export const describeDb = describe.skipIf(!hasTestDatabase);

/** Tables the database tier writes to. Truncated between tests. */
const MANAGED_TABLES = [
  "accounts",
  "credits",
  "email_blocklist",
  "files",
  "jobs",
  "orders",
  "org_invitations",
  "org_members",
  "organizations",
  "sessions",
  "stripe_webhook_events",
  "subscriptions",
  "tasks",
  "users",
  // Password-reset and email-verification tokens. Left out, they accumulate
  // across every file in the tier, and a test that looks up "the reset token"
  // finds one issued to a different user in an earlier test.
  "verifications",
] as const;

/**
 * Serialize the tier across *processes*, not just within one run.
 *
 * `vitest.config.mts` already forces this tier through a single fork, which
 * stops two files in the same run from truncating each other. Nothing stopped
 * two *runs*: a second `pnpm test:db`, an editor task, a CI job sharing one
 * database, or a second agent working in the same checkout. They all point at
 * the same `sushi_test`, and `resetTables` below is a `truncate ... cascade`.
 *
 * The failure that produces is genuinely baffling to read, which is why this
 * exists. The other process wipes `users` between your seed and your assertion,
 * so you get "failed to create personal organization" out of `beforeEach` — an
 * error about auth, on a test about credits, that reproduces about a third of
 * the time and never in isolation. Whoever sees it next should not have to
 * rediscover that it was never their test.
 *
 * A session-scoped advisory lock is the right shape: it is held by a connection
 * rather than a row, needs no table, and Postgres drops it if the process is
 * killed — so a `ctrl-c`'d run cannot wedge the next one.
 */
// Two int4s rather than one bigint: `pg_advisory_lock` has both signatures, and
// this one needs no BigInt literal, which the repo's compile target rejects.
// The values spell "SUSH"/"D_TE" and mean nothing beyond being unlikely to
// collide with an application lock — `lockOrgAndSumLedger` hashes org uuids.
export const TIER_LOCK_KEY = [0x5355_5348, 0x445f_5445] as const;

/** How long to wait for another test process before giving up. */
const LOCK_TIMEOUT_MS = 120_000;

let lockClient: ReturnType<typeof postgres> | null = null;
let lockHeld: Promise<void> | null = null;

/**
 * Take the tier lock, blocking while another process holds it.
 *
 * Memoized per module registry — Vitest re-evaluates modules per test file, so
 * in practice this is once per file: each file takes the lock, runs, and hands
 * it on. That interleaves two concurrent runs file-by-file instead of making
 * one wait for the whole other tier.
 */
async function acquireTierLock(): Promise<void> {
  if (!rawUrl) return;
  if (lockHeld) return lockHeld;

  lockHeld = (async () => {
    // A dedicated connection, never the pooled one. An advisory lock belongs to
    // the session that took it, and a pool is free to hand that session to
    // someone else or recycle it — at which point the lock silently vanishes.
    lockClient = postgres(rawUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      // Bound the wait in the database rather than in a polling loop, so a
      // stuck holder surfaces as an error instead of a hung suite.
      connection: { lock_timeout: LOCK_TIMEOUT_MS },
    });

    try {
      await lockClient`select pg_advisory_lock(${TIER_LOCK_KEY[0]}, ${TIER_LOCK_KEY[1]})`;
    } catch (error) {
      await lockClient.end({ timeout: 5 }).catch(() => {});
      lockClient = null;
      throw new Error(
        `Timed out after ${LOCK_TIMEOUT_MS / 1000}s waiting for the database test lock. ` +
          `Another process is running this tier against the same database — check for a ` +
          `second "vitest --project db" or "pnpm test:db". They cannot share one database: ` +
          `each truncates the tables the other is mid-test on.`,
        { cause: error }
      );
    }
  })();

  return lockHeld;
}

/**
 * Release the tier lock by dropping the connection that holds it.
 *
 * Ending the session is what releases a session-scoped lock, and it releases
 * every level of it — which matters because the lock is re-entrant and a file
 * that acquired twice would otherwise leak a level.
 */
async function releaseTierLock(): Promise<void> {
  const client = lockClient;
  lockClient = null;
  lockHeld = null;
  await client?.end({ timeout: 5 }).catch(() => {});
}

/**
 * Truncate managed tables and reset identity sequences.
 *
 * Truncation rather than a per-test transaction rollback: the concurrency tests
 * need two connections to see each other's committed work, which an
 * uncommitted wrapping transaction would hide.
 */
export async function resetTables(): Promise<void> {
  // Never truncate without the tier lock. A file that reaches for this helper
  // outside `useCleanDatabase` is still destructive to a concurrent run.
  await acquireTierLock();

  const { db } = await import("@/db");
  const list = MANAGED_TABLES.map((t) => `"${t}"`).join(", ");
  await db().execute(sql.raw(`truncate table ${list} restart identity cascade`));
}

/**
 * Close the shared connection and hand the database back, once per file.
 *
 * Registered here at module scope, which attaches it to the file's root suite
 * rather than to one `describe`. That distinction is load-bearing: `db()` hands
 * out a process-wide singleton, so ending its client is a file-wide act. When
 * this lived inside `useCleanDatabase`, a file with two `describeDb` blocks —
 * `stripe.webhook-events.test.ts` is one — ended the connection when the first
 * block finished, and the second block's `beforeEach` truncate then failed with
 * `CONNECTION_ENDED` on a client nobody could see had been closed.
 */
if (rawUrl) {
  afterAll(async () => {
    try {
      const { db } = await import("@/db");
      const client = (db() as unknown as { $client?: { end?: () => Promise<void> } })
        .$client;
      await client?.end?.();
    } finally {
      // Whatever happened above, the next process is entitled to the database
      // back. A `finally` because a teardown that throws while holding the lock
      // would block every later run until this process exits.
      await releaseTierLock();
    }
  });
}

/**
 * Standard lifecycle for a database test file: clean slate before each test.
 *
 * Safe to call from more than one `describe` in a file. Teardown is registered
 * once, above, for the file as a whole.
 */
export function useCleanDatabase(): void {
  // Claim the database before the first test rather than inside the first
  // `beforeEach`, so the wait for another process is attributed to the file
  // instead of showing up as one mysteriously slow test.
  beforeAll(async () => {
    await acquireTierLock();
  }, LOCK_TIMEOUT_MS + 30_000);

  beforeEach(async () => {
    await resetTables();
  });
}

/** Postgres unique-violation code, surfaced directly or wrapped in `cause`. */
export const UNIQUE_VIOLATION = "23505";

export function errorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
}
