#!/usr/bin/env node
/**
 * Apply migrations to the throwaway database used by `pnpm test:db`.
 *
 * Exists so the database tier has a one-command setup that works the same on a
 * laptop and in CI, and so the "must be a test database" guard is enforced
 * before drizzle-kit ever connects — not only inside the test files.
 *
 *   TEST_DATABASE_URL=postgresql://localhost:5432/sushi_test pnpm test:db:setup
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Read TEST_DATABASE_URL out of the env files the way the app reads its own
// config, so `pnpm test:db:setup` works without exporting anything by hand.
// An explicit shell value wins.
if (!process.env.TEST_DATABASE_URL?.trim()) {
  for (const file of [".env", ".env.local"]) {
    const filePath = resolve(root, file);
    if (!existsSync(filePath)) continue;
    const value = parse(readFileSync(filePath)).TEST_DATABASE_URL?.trim();
    if (value) process.env.TEST_DATABASE_URL = value;
  }
}

const url = process.env.TEST_DATABASE_URL?.trim();

if (!url) {
  console.error(
    "TEST_DATABASE_URL is not set.\n\n" +
      "  createdb sushi_test\n" +
      "  TEST_DATABASE_URL=postgresql://localhost:5432/sushi_test pnpm test:db:setup\n"
  );
  process.exit(1);
}

let name;
try {
  name = new URL(url).pathname.replace(/^\//, "");
} catch {
  console.error(`TEST_DATABASE_URL is not a valid connection URL: ${url}`);
  process.exit(1);
}

// Same rule as tests/db/setup.ts. The tests truncate tables, so pointing this
// at a database that holds anything you care about is the one unrecoverable
// mistake available here.
if (!name.toLowerCase().includes("test")) {
  console.error(
    `Refusing to migrate "${name}": the test database is truncated on every ` +
      `test, so its name must contain "test".`
  );
  process.exit(1);
}

const result = spawnSync(
  "pnpm",
  ["exec", "drizzle-kit", "migrate", "--config", "src/db/config.ts"],
  {
    stdio: "inherit",
    // dotenv does not override variables that are already set, so this wins
    // over whatever DATABASE_URL sits in .env.local.
    env: { ...process.env, DATABASE_URL: url },
  }
);

process.exit(result.status ?? 1);
