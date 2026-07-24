#!/usr/bin/env node
/**
 * Apply migrations to a deployed database. `pnpm db:migrate:prod`
 *
 * Separate from `pnpm db:migrate` (drizzle-kit, for local use) because a
 * production migration has requirements a dev one does not:
 *
 *   - It runs from a release pipeline, so it must be non-interactive and exit
 *     non-zero on any failure.
 *   - It must be safe to invoke twice. Two deploys landing together, or a
 *     retried job, must not run the same migration concurrently — hence the
 *     advisory lock below.
 *   - It only needs runtime dependencies (drizzle-orm, postgres), not
 *     drizzle-kit, so it works in a pruned production install.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs --check   # report only
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = resolve(root, "src/db/migrations");

/**
 * Arbitrary but fixed. Every deploy takes this same lock, so concurrent
 * pipelines serialise instead of racing each other through the same DDL.
 */
const MIGRATION_LOCK_ID = 4915623014n;

const checkOnly = process.argv.includes("--check");
const url = process.env.DATABASE_URL?.trim();

if (!url) {
  console.error("DATABASE_URL is required.\n\n  DATABASE_URL=postgres://... node scripts/migrate.mjs\n");
  process.exit(1);
}

function readJournal() {
  const path = resolve(migrationsFolder, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(path, "utf8"));
  return journal.entries ?? [];
}

async function appliedCount(sql) {
  // drizzle-orm records applied migrations here. Absent on a fresh database.
  const rows = await sql`
    select count(*)::int as count
    from information_schema.tables
    where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
  `;
  if (rows[0]?.count === 0) return 0;

  const [row] = await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;
  return row?.count ?? 0;
}

const redacted = url.replace(/\/\/[^@]*@/, "//***@");
console.log(`Migrating ${redacted}`);

// max: 1 — a migration is a single serial session; a pool would let the
// advisory lock and the DDL land on different connections.
const sql = postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });
const db = drizzle(sql);

let exitCode = 0;

try {
  const entries = readJournal();
  const already = await appliedCount(sql);
  const pending = entries.length - already;

  console.log(`  ${entries.length} migration(s) in repo, ${already} already applied`);

  if (pending <= 0) {
    console.log("  nothing to apply");
  } else if (checkOnly) {
    console.log(`  ${pending} pending:`);
    for (const entry of entries.slice(already)) {
      console.log(`    - ${entry.tag}`);
    }
    // --check is a report, not a gate: exit 0 either way so a pipeline can use
    // it for visibility without branching on the result.
  } else {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    try {
      await migrate(db, { migrationsFolder });
      console.log(`  applied ${pending} migration(s)`);
    } finally {
      await sql`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
    }
  }
} catch (error) {
  console.error("\nMigration failed:");
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

process.exit(exitCode);
