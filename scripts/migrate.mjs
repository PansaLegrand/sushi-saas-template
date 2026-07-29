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
 *   DATABASE_URL=postgres://... node scripts/migrate.mjs --check   # release gate
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { inspectMigrationState } from "./migration-state.mjs";

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

function readExpectedMigrations() {
  const entries = readJournal();
  const migrations = readMigrationFiles({ migrationsFolder });

  if (entries.length !== migrations.length) {
    throw new Error(
      `Migration journal lists ${entries.length} entries but ` +
        `${migrations.length} SQL files were loaded`,
    );
  }

  for (const [index, entry] of entries.entries()) {
    const previous = entries[index - 1];
    if (entry.idx !== index) {
      throw new Error(
        `Migration journal entry ${entry.tag} has index ${entry.idx}; expected ${index}`,
      );
    }
    if (
      !Number.isSafeInteger(entry.when) ||
      (previous && entry.when <= previous.when)
    ) {
      throw new Error(
        `Migration journal entry ${entry.tag} does not have a strictly increasing timestamp`,
      );
    }
  }

  return migrations.map((migration, index) => ({
    folderMillis: migration.folderMillis,
    hash: migration.hash,
    tag: entries[index].tag,
  }));
}

async function readAppliedMigrations(sql) {
  // drizzle-orm records applied migrations here. Absent on a fresh database.
  const rows = await sql`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'drizzle'
        and table_name = '__drizzle_migrations'
    ) as "exists"
  `;
  if (!rows[0]?.exists) return [];

  const applied = await sql`
    select "hash", "created_at"
    from "drizzle"."__drizzle_migrations"
    order by "created_at" asc, "id" asc
  `;

  return applied.map((migration) => ({
    folderMillis: Number(migration.created_at),
    hash: String(migration.hash),
  }));
}

function requireCompatibleState(applied, expected) {
  const state = inspectMigrationState(applied, expected);

  if (state.status === "diverged") {
    throw new Error(`Migration history diverged: ${state.reason}`);
  }

  return state;
}

function printState(state, expectedCount, appliedCount) {
  console.log(
    `  ${expectedCount} migration(s) in repo, ${appliedCount} already applied`,
  );

  if (state.status === "current") {
    console.log("  nothing to apply");
    return;
  }

  console.log(`  ${state.pending.length} pending:`);
  for (const migration of state.pending) {
    console.log(`    - ${migration.tag}`);
  }
}

const redacted = url.replace(/\/\/[^@]*@/, "//***@");
console.log(`Migrating ${redacted}`);

// max: 1 — a migration is a single serial session; a pool would let the
// advisory lock and the DDL land on different connections.
const sql = postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });
const db = drizzle(sql);

let exitCode = 0;

try {
  const expected = readExpectedMigrations();

  if (checkOnly) {
    const applied = await readAppliedMigrations(sql);
    const state = requireCompatibleState(applied, expected);
    printState(state, expected.length, applied.length);

    // A check is a release gate: pending migrations mean this artifact is not
    // safe to deploy yet.
    if (state.status === "pending") {
      exitCode = 1;
    }
  } else {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    try {
      const applied = await readAppliedMigrations(sql);
      const before = requireCompatibleState(applied, expected);
      printState(before, expected.length, applied.length);

      if (before.status === "pending") {
        await migrate(db, { migrationsFolder });

        const verified = await readAppliedMigrations(sql);
        const after = requireCompatibleState(verified, expected);
        if (after.status !== "current") {
          throw new Error(
            `Migration verification failed: ${after.pending.length} still pending`,
          );
        }

        console.log(`  applied and verified ${before.pending.length} migration(s)`);
      }
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
