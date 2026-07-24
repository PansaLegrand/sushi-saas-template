#!/usr/bin/env node
/**
 * One-command local bootstrap: `pnpm setup`
 *
 *   1. writes .env from .env.example, with real secrets generated
 *   2. starts the Postgres container
 *   3. applies migrations to the dev and test databases
 *
 * Safe to re-run. An existing .env is never overwritten — the whole point of
 * this script is that it cannot cost you a working local config.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");

const DEV_DATABASE_URL = "postgresql://sushi:sushi@localhost:5432/sushi_dev";
const TEST_DATABASE_URL = "postgresql://sushi:sushi@localhost:5432/sushi_test";

// Cloudflare's documented always-passes Turnstile keys. Local only — the app
// refuses to start in production unless real keys are set or captcha is
// explicitly disabled.
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

const step = (msg) => console.log(`\n\x1b[1m▸ ${msg}\x1b[0m`);
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const warn = (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);

function run(command, args, env = {}) {
  return spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

function has(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

/** Replace `KEY=` (empty value only) so hand-edited values survive a re-run. */
function fill(contents, key, value) {
  const pattern = new RegExp(`^${key}=\\s*$`, "m");
  if (!pattern.test(contents)) return contents;
  const quoted = /[\s"]/.test(value) ? JSON.stringify(value) : value;
  return contents.replace(pattern, `${key}=${quoted}`);
}

// ---------------------------------------------------------------- 1. env file

step("Environment file");

if (existsSync(envPath)) {
  ok(".env already exists — leaving it untouched");
} else {
  if (!existsSync(examplePath)) {
    console.error("  .env.example is missing; cannot bootstrap.");
    process.exit(1);
  }

  let contents = readFileSync(examplePath, "utf8");
  contents = fill(contents, "DATABASE_URL", DEV_DATABASE_URL);
  contents = fill(contents, "TEST_DATABASE_URL", TEST_DATABASE_URL);
  contents = fill(contents, "BETTER_AUTH_SECRET", randomBytes(32).toString("base64"));
  contents = fill(contents, "CRON_SECRET", randomBytes(32).toString("hex"));
  contents = fill(contents, "NEXT_PUBLIC_TURNSTILE_SITE_KEY", TURNSTILE_TEST_SITE_KEY);
  contents = fill(contents, "TURNSTILE_SECRET_KEY", TURNSTILE_TEST_SECRET_KEY);

  writeFileSync(envPath, contents, { mode: 0o600 });
  ok("wrote .env with generated BETTER_AUTH_SECRET and CRON_SECRET");
  warn("Stripe, Resend, and storage keys are still blank — fill them when you need those features");
}

// ---------------------------------------------------------------- 2. database

step("Database");

const dockerAvailable = has("docker");

if (!dockerAvailable) {
  warn("docker not found — start Postgres yourself, then re-run this script");
  warn(`expected: ${DEV_DATABASE_URL}`);
  process.exit(0);
}

/**
 * Port 5432 is the default for every Postgres install, so a developer who
 * already runs one locally hits a collision here. Detect it and explain,
 * rather than letting `docker compose` fail with "port is already allocated".
 */
function portInUse(port) {
  const probe = spawnSync("nc", ["-z", "127.0.0.1", String(port)], { stdio: "ignore" });
  return probe.status === 0;
}

const composeRunning =
  spawnSync("docker", ["compose", "ps", "-q", "postgres"], {
    cwd: root,
    encoding: "utf8",
  }).stdout?.trim().length > 0;

if (portInUse(5432) && !composeRunning) {
  console.log(`
  \x1b[33mPort 5432 is already in use\x1b[0m — you appear to have Postgres running already.

  That is fine, and probably better than starting a second one. Create two
  databases on it and point .env at them:

    createdb sushi_dev && createdb sushi_test
    # or, if it runs in a container named <name>:
    docker exec <name> psql -U postgres -c "create database sushi_dev;" -c "create database sushi_test;"

  Then set both URLs in .env to match that server's user, password, and port:

    DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/sushi_dev
    TEST_DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/sushi_test

  Finally:

    pnpm db:migrate && pnpm test:db:setup

  To use this repo's container instead, stop the other Postgres first and
  re-run \x1b[1mpnpm setup\x1b[0m.
`);
  process.exit(0);
}

if (run("docker", ["compose", "up", "-d"]).status !== 0) {
  console.error("  docker compose failed; is Docker running?");
  process.exit(1);
}

process.stdout.write("  waiting for Postgres");
let ready = false;
for (let i = 0; i < 30; i += 1) {
  const probe = spawnSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "sushi", "-d", "sushi_dev"],
    { cwd: root, stdio: "ignore" }
  );
  if (probe.status === 0) {
    ready = true;
    break;
  }
  process.stdout.write(".");
  // Blocking sleep: this script is a linear bootstrap, not an event loop.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
}
console.log("");

if (!ready) {
  console.error("  Postgres did not become ready. Check `docker compose logs postgres`.");
  process.exit(1);
}
ok("Postgres is up on localhost:5432 (sushi_dev, sushi_test)");

// -------------------------------------------------------------- 3. migrations

step("Migrations");

const migrateArgs = ["exec", "drizzle-kit", "migrate", "--config", "src/db/config.ts"];

if (run("pnpm", migrateArgs, { DATABASE_URL: DEV_DATABASE_URL }).status !== 0) {
  console.error("  migration failed against sushi_dev");
  process.exit(1);
}
ok("sushi_dev migrated");

if (run("pnpm", migrateArgs, { DATABASE_URL: TEST_DATABASE_URL }).status !== 0) {
  console.error("  migration failed against sushi_test");
  process.exit(1);
}
ok("sushi_test migrated");

console.log(`
\x1b[1mReady.\x1b[0m

  pnpm dev        → http://localhost:3000
  pnpm dev:admin  → http://localhost:3001
  pnpm test:db    → database tier now runs instead of skipping

To promote yourself to admin after signing up:

  docker compose exec postgres psql -U sushi -d sushi_dev \\
    -c "update users set role='admin_rw' where email='you@example.com';"
`);
