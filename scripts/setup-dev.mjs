#!/usr/bin/env node
/**
 * One-command local bootstrap: `pnpm run setup`
 *
 *   1. writes missing development profiles, with real secrets
 *   2. starts the Postgres, Redis, and local S3 containers
 *   3. applies migrations to the app, test, and Content Studio databases
 *      and provisions an isolated restore-drill target
 *
 * Safe to re-run. Existing environment files are never overwritten — the
 * whole point of this script is that it cannot cost you a working local config.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const developmentEnvPath = resolve(root, ".env.development.local");
const localEnvPath = resolve(root, ".env.local");
const legacyEnvPath = resolve(root, ".env");
const examplePath = resolve(root, ".env.example");
const contentDevelopmentEnvPath = resolve(
  root,
  "apps/content-studio/.env.development.local",
);
const contentLocalEnvPath = resolve(root, "apps/content-studio/.env.local");
const contentExamplePath = resolve(root, "apps/content-studio/.env.example");

// Fresh clones use environment-specific files. Existing clones keep working
// without a forced migration: use the most specific file that already exists,
// falling back to the legacy .env locations only when necessary.
const envPath =
  [developmentEnvPath, localEnvPath, legacyEnvPath].find(existsSync) ??
  developmentEnvPath;
const contentEnvPath =
  [contentDevelopmentEnvPath, contentLocalEnvPath].find(existsSync) ??
  contentDevelopmentEnvPath;
const displayPath = (path) => path.slice(root.length + 1);

const DEV_DATABASE_URL = "postgresql://sushi:sushi@localhost:5432/sushi_dev";
const TEST_DATABASE_URL = "postgresql://sushi:sushi@localhost:5432/sushi_test";
const CONTENT_DATABASE_URL =
  "postgresql://sushi:sushi@localhost:5432/sushi_content";
const RESTORE_DATABASE_URL =
  "postgresql://sushi:sushi@localhost:5432/sushi_restore_drill";
const DEV_REDIS_URL = "redis://localhost:6379";
const DEV_STORAGE_ENDPOINT = "http://localhost:3900";
const DEV_STORAGE_REGION = "garage";
const DEV_STORAGE_BUCKET = "sushi-dev";
const DEV_STORAGE_ACCESS_KEY = "GK0123456789abcdef01234567";
const DEV_STORAGE_SECRET_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

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

function readValue(contents, key) {
  const match = contents.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) return "";
  const value = match[1].trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return "";
    }
  }
  return value;
}

// ---------------------------------------------------------------- 1. env file

step("Environment file");

let marketingSecret = randomBytes(32).toString("hex");
let rootHasMarketingSecret = false;

if (existsSync(envPath)) {
  ok(`${displayPath(envPath)} already exists — leaving it untouched`);
  const existingSecret = readValue(
    readFileSync(envPath, "utf8"),
    "CONTENT_MARKETING_SECRET",
  );
  if (existingSecret) {
    marketingSecret = existingSecret;
    rootHasMarketingSecret = true;
  }
} else {
  if (!existsSync(examplePath)) {
    console.error("  .env.example is missing; cannot bootstrap.");
    process.exit(1);
  }

  let contents = readFileSync(examplePath, "utf8");
  contents = fill(contents, "DATABASE_URL", DEV_DATABASE_URL);
  contents = fill(contents, "TEST_DATABASE_URL", TEST_DATABASE_URL);
  contents = fill(contents, "RESTORE_DATABASE_URL", RESTORE_DATABASE_URL);
  contents = fill(contents, "RATE_LIMIT_REDIS_URL", DEV_REDIS_URL);
  contents = fill(contents, "TEST_REDIS_URL", DEV_REDIS_URL);
  contents = fill(
    contents,
    "BETTER_AUTH_SECRET",
    randomBytes(32).toString("base64"),
  );
  contents = fill(contents, "CRON_SECRET", randomBytes(32).toString("hex"));
  contents = fill(contents, "CONTENT_MARKETING_SECRET", marketingSecret);
  contents = fill(
    contents,
    "MARKETING_UNSUBSCRIBE_SECRET",
    randomBytes(32).toString("hex"),
  );
  contents = fill(
    contents,
    "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    TURNSTILE_TEST_SITE_KEY,
  );
  contents = fill(contents, "TURNSTILE_SECRET_KEY", TURNSTILE_TEST_SECRET_KEY);
  contents = fill(contents, "STORAGE_PROVIDER", "garage");
  contents = fill(contents, "STORAGE_ENDPOINT", DEV_STORAGE_ENDPOINT);
  contents = fill(contents, "STORAGE_REGION", DEV_STORAGE_REGION);
  contents = fill(contents, "STORAGE_ACCESS_KEY", DEV_STORAGE_ACCESS_KEY);
  contents = fill(contents, "STORAGE_SECRET_KEY", DEV_STORAGE_SECRET_KEY);
  contents = fill(contents, "STORAGE_BUCKET", DEV_STORAGE_BUCKET);

  writeFileSync(envPath, contents, { mode: 0o600 });
  rootHasMarketingSecret = true;
  ok(
    `wrote ${displayPath(envPath)} with generated application and marketing secrets`,
  );
  warn(
    "Stripe and Resend keys are still blank — fill them when you need those features",
  );
}

const useBundledStorage =
  (process.env.STORAGE_PROVIDER?.trim() ||
    readValue(readFileSync(envPath, "utf8"), "STORAGE_PROVIDER")) === "garage";

let payloadSecret = randomBytes(32).toString("hex");
if (existsSync(contentEnvPath)) {
  ok(`${displayPath(contentEnvPath)} already exists — leaving it untouched`);
  const existingPayloadSecret = readValue(
    readFileSync(contentEnvPath, "utf8"),
    "PAYLOAD_SECRET",
  );
  if (existingPayloadSecret) payloadSecret = existingPayloadSecret;
} else {
  if (!existsSync(contentExamplePath)) {
    console.error(
      "  apps/content-studio/.env.example is missing; cannot bootstrap.",
    );
    process.exit(1);
  }

  let contents = readFileSync(contentExamplePath, "utf8");
  contents = fill(contents, "CONTENT_DATABASE_URL", CONTENT_DATABASE_URL);
  contents = fill(contents, "PAYLOAD_SECRET", payloadSecret);
  contents = fill(contents, "CONTENT_MARKETING_SECRET", marketingSecret);
  writeFileSync(contentEnvPath, contents, { mode: 0o600 });
  ok(`wrote ${displayPath(contentEnvPath)} with generated Payload credentials`);

  if (!rootHasMarketingSecret) {
    warn(
      `set ${displayPath(envPath)} CONTENT_MARKETING_SECRET to the matching value in ${displayPath(contentEnvPath)} before using marketing delivery`,
    );
  }
}

// ------------------------------------------------------ 2. local infrastructure

step("Local infrastructure");

const dockerAvailable = has("docker");

if (!dockerAvailable) {
  warn(
    "docker not found — provide Postgres, Redis, and S3-compatible storage yourself, then re-run this script",
  );
  warn(`expected: ${DEV_DATABASE_URL}`);
  warn(`expected: ${DEV_REDIS_URL}`);
  if (useBundledStorage) warn(`expected: ${DEV_STORAGE_ENDPOINT}`);
  process.exit(0);
}

/**
 * Port 5432 is the default for every Postgres install, so a developer who
 * already runs one locally hits a collision here. Detect it and explain,
 * rather than letting `docker compose` fail with "port is already allocated".
 */
function portInUse(port) {
  const probe = spawnSync("nc", ["-z", "127.0.0.1", String(port)], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

const postgresComposeRunning =
  spawnSync("docker", ["compose", "ps", "-q", "postgres"], {
    cwd: root,
    encoding: "utf8",
  }).stdout?.trim().length > 0;

if (portInUse(5432) && !postgresComposeRunning) {
  console.log(`
  \x1b[33mPort 5432 is already in use\x1b[0m — you appear to have Postgres running already.

  That is fine, and probably better than starting a second one. Create four
  databases on it and point your development profile at them:

    createdb sushi_dev && createdb sushi_test && createdb sushi_content && createdb sushi_restore_drill
    # or, if it runs in a container named <name>:
    docker exec <name> psql -U postgres -c "create database sushi_dev;" -c "create database sushi_test;" -c "create database sushi_content;" -c "create database sushi_restore_drill;"

  Then set the SaaS/test URLs in ${displayPath(envPath)} and the Content Studio URL in
  ${displayPath(contentEnvPath)} to match that server's credentials:

    DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/sushi_dev
    TEST_DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/sushi_test
    RESTORE_DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/sushi_restore_drill
    CONTENT_DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/sushi_content

  Finally:

    pnpm db:migrate && pnpm test:db:setup && pnpm studio:migrate

  To use this repo's container instead, stop the other Postgres first and
  re-run \x1b[1mpnpm run setup\x1b[0m.
`);
  process.exit(0);
}

const redisComposeRunning =
  spawnSync("docker", ["compose", "ps", "-q", "redis"], {
    cwd: root,
    encoding: "utf8",
  }).stdout?.trim().length > 0;
const externalRedisRunning = portInUse(6379) && !redisComposeRunning;

const garageComposeRunning =
  spawnSync("docker", ["compose", "ps", "-q", "garage"], {
    cwd: root,
    encoding: "utf8",
  }).stdout?.trim().length > 0;

if (useBundledStorage && portInUse(3900) && !garageComposeRunning) {
  console.error(`
  \x1b[31mPort 3900 is already in use\x1b[0m and is required by the bundled local S3 service.

  Stop the process using that port, or configure a different external storage
  provider in ${displayPath(envPath)} and start only the services you need.
`);
  process.exit(1);
}

const composeServices = ["postgres"];
if (!externalRedisRunning) composeServices.push("redis");
if (useBundledStorage) composeServices.push("garage");

if (externalRedisRunning) {
  warn("port 6379 is already in use — using the existing local Redis service");
}

if (run("docker", ["compose", "up", "-d", ...composeServices]).status !== 0) {
  console.error("  docker compose failed; is Docker running?");
  process.exit(1);
}

process.stdout.write("  waiting for Postgres");
let ready = false;
for (let i = 0; i < 30; i += 1) {
  const probe = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "pg_isready",
      "-U",
      "sushi",
      "-d",
      "sushi_dev",
    ],
    { cwd: root, stdio: "ignore" },
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
  console.error(
    "  Postgres did not become ready. Check `docker compose logs postgres`.",
  );
  process.exit(1);
}
for (const database of ["sushi_content", "sushi_restore_drill"]) {
  const exists = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "sushi",
      "-d",
      "postgres",
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname = '${database}'`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (exists.status !== 0) {
    console.error(`  could not check the ${database} database`);
    process.exit(1);
  }
  if (exists.stdout.trim() === "1") continue;

  const created = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "createdb",
      "-U",
      "sushi",
      "-O",
      "sushi",
      database,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (created.status !== 0) {
    console.error(`  could not create the ${database} database`);
    process.exit(1);
  }
}
ok(
  "Postgres is up on localhost:5432 (sushi_dev, sushi_test, sushi_content, sushi_restore_drill)",
);

if (!externalRedisRunning) {
  process.stdout.write("  waiting for Redis");
  let redisReady = false;
  for (let i = 0; i < 30; i += 1) {
    const probe = spawnSync(
      "docker",
      ["compose", "exec", "-T", "redis", "redis-cli", "ping"],
      { cwd: root, stdio: "ignore" },
    );
    if (probe.status === 0) {
      redisReady = true;
      break;
    }
    process.stdout.write(".");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  console.log("");

  if (!redisReady) {
    console.error(
      "  Redis did not become ready. Check `docker compose logs redis`.",
    );
    process.exit(1);
  }
}
ok("Redis is available on localhost:6379");

if (useBundledStorage) {
  process.stdout.write("  waiting for local S3 storage");
  const storageClient = new S3Client({
    region: DEV_STORAGE_REGION,
    endpoint: DEV_STORAGE_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: DEV_STORAGE_ACCESS_KEY,
      secretAccessKey: DEV_STORAGE_SECRET_KEY,
    },
  });
  let storageReady = false;
  for (let i = 0; i < 30; i += 1) {
    try {
      await storageClient.send(
        new HeadBucketCommand({ Bucket: DEV_STORAGE_BUCKET }),
      );
      storageReady = true;
      break;
    } catch {
      process.stdout.write(".");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }
  console.log("");

  if (!storageReady) {
    console.error(
      "  local S3 storage did not become ready. Check `docker compose logs garage`.",
    );
    process.exit(1);
  }

  await storageClient.send(
    new PutBucketCorsCommand({
      Bucket: DEV_STORAGE_BUCKET,
      CORSConfiguration: {
        // Garage emits one Access-Control-Allow-Origin value per matching rule.
        // Keeping each origin in its own rule prevents a comma-joined response,
        // which browsers reject even though both individual origins are valid.
        CORSRules: ["http://localhost:3000", "http://localhost:3100"].map(
          (origin) => ({
            AllowedOrigins: [origin],
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3000,
          }),
        ),
      },
    }),
  );
  ok("private local S3 bucket is ready on localhost:3900 (sushi-dev)");
} else {
  ok("external object storage configuration preserved");
}

// -------------------------------------------------------------- 3. migrations

step("Migrations");

const migrateArgs = [
  "exec",
  "drizzle-kit",
  "migrate",
  "--config",
  "src/db/config.ts",
];

if (run("pnpm", migrateArgs, { DATABASE_URL: DEV_DATABASE_URL }).status !== 0) {
  console.error("  migration failed against sushi_dev");
  process.exit(1);
}
ok("sushi_dev migrated");

if (
  run("pnpm", migrateArgs, { DATABASE_URL: TEST_DATABASE_URL }).status !== 0
) {
  console.error("  migration failed against sushi_test");
  process.exit(1);
}
ok("sushi_test migrated");

if (
  run("pnpm", ["--dir", "apps/content-studio", "migrate"], {
    CONTENT_DATABASE_URL,
    PAYLOAD_SECRET: payloadSecret,
  }).status !== 0
) {
  console.error("  Content Studio migration failed against sushi_content");
  process.exit(1);
}
ok("sushi_content migrated");

console.log(`
\x1b[1mReady.\x1b[0m

  pnpm dev:doctor → verify the complete local stack
  pnpm dev:all    → web :3000, admin :3001, studio :3002
  pnpm dev:seed   → idempotent demo login, credits, and catalog
  pnpm test:db    → database tier now runs instead of skipping

To promote yourself to admin after signing up:

  pnpm admin:promote you@example.com
`);
