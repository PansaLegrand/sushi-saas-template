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
import { afterAll, beforeEach, describe } from "vitest";
import { sql } from "drizzle-orm";

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
  "credits",
  "files",
  "jobs",
  "orders",
  "org_invitations",
  "org_members",
  "organizations",
  "subscriptions",
  "tasks",
  "users",
] as const;

/**
 * Truncate managed tables and reset identity sequences.
 *
 * Truncation rather than a per-test transaction rollback: the concurrency tests
 * need two connections to see each other's committed work, which an
 * uncommitted wrapping transaction would hide.
 */
export async function resetTables(): Promise<void> {
  const { db } = await import("@/db");
  const list = MANAGED_TABLES.map((t) => `"${t}"`).join(", ");
  await db().execute(sql.raw(`truncate table ${list} restart identity cascade`));
}

/**
 * Standard lifecycle for a database test file: clean slate before each test,
 * connection closed at the end so the worker can exit.
 */
export function useCleanDatabase(): void {
  beforeEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    const { db } = await import("@/db");
    const client = (db() as unknown as { $client?: { end?: () => Promise<void> } })
      .$client;
    await client?.end?.();
  });
}

/** Postgres unique-violation code, surfaced directly or wrapped in `cause`. */
export const UNIQUE_VIOLATION = "23505";

export function errorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
}
