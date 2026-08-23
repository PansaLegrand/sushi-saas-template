#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectDevelopmentDatabaseUrl,
  inspectDevelopmentRedisUrl,
  inspectDevelopmentStorage,
} from "./lib/dev-safety.mjs";
import { loadDevelopmentAppProfile } from "./lib/profile-loader.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2).filter((arg) => arg !== "--"));

if (args.has("--help") || args.has("-h")) {
  console.log(`Usage: pnpm dev:reset [--yes] [--no-seed] [--dry-run]

Destroys only this repository's Docker development volumes, then recreates and
migrates PostgreSQL, Redis, Garage storage, and optionally demo fixtures.

Options:
  --yes       Skip the interactive confirmation
  --no-seed   Recreate infrastructure without demo fixtures
  --dry-run   Print the validated targets without changing anything`);
  process.exit(0);
}

const allowed = new Set(["--yes", "--no-seed", "--dry-run"]);
for (const arg of args) {
  if (!allowed.has(arg)) {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
}

async function main() {
  const profile = loadDevelopmentAppProfile(root);
  if (!profile) {
    console.error("Refusing to reset without a development profile.");
    process.exit(1);
  }

  const checks = [
    [
      "DATABASE_URL",
      inspectDevelopmentDatabaseUrl(
        process.env.DATABASE_URL ?? "",
        "sushi_dev",
      ),
    ],
    [
      "TEST_DATABASE_URL",
      inspectDevelopmentDatabaseUrl(
        process.env.TEST_DATABASE_URL ?? "",
        "sushi_test",
      ),
    ],
    [
      "RATE_LIMIT_REDIS_URL",
      inspectDevelopmentRedisUrl(process.env.RATE_LIMIT_REDIS_URL ?? ""),
    ],
    ["storage", inspectDevelopmentStorage(process.env)],
  ] as const;

  let unsafe = false;
  for (const [name, result] of checks) {
    if (result.ok) continue;
    unsafe = true;
    for (const reason of result.reasons) console.error(`${name} ${reason}`);
  }
  if (unsafe) {
    console.error(
      "Refusing to reset because the profile is not the bundled local stack.",
    );
    process.exit(1);
  }

  console.log(`
Validated reset target: ${profile.relativePath}

  PostgreSQL: sushi_dev, sushi_test, sushi_content on loopback:5432
  Redis:      loopback:6379
  Storage:    Garage bucket sushi-dev on loopback:3900

The ignored environment profiles are preserved.
`);

  if (args.has("--dry-run")) process.exit(0);

  if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    console.error("Docker is not running.");
    process.exit(1);
  }

  if (!args.has("--yes")) {
    if (!process.stdin.isTTY) {
      console.error(
        "Interactive confirmation is unavailable; pass --yes explicitly.",
      );
      process.exit(1);
    }
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await rl.question('Type "reset local data" to continue: ');
    rl.close();
    if (answer !== "reset local data") {
      console.log("Reset canceled.");
      process.exit(0);
    }
  }

  const down = spawnSync(
    "docker",
    ["compose", "down", "--volumes", "--remove-orphans"],
    { cwd: root, stdio: "inherit" },
  );
  if (down.status !== 0) process.exit(down.status ?? 1);

  const setup = spawnSync("node", ["scripts/setup-dev.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  if (setup.status !== 0) process.exit(setup.status ?? 1);

  if (!args.has("--no-seed")) {
    const seed = spawnSync("pnpm", ["dev:seed"], {
      cwd: root,
      stdio: "inherit",
    });
    if (seed.status !== 0) process.exit(seed.status ?? 1);
  }

  console.log("Local development data was reset successfully.");
}

main().catch((error) => {
  console.error("Could not reset the local development stack.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
