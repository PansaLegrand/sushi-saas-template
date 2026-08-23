#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { parse } from "dotenv";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const valueFor = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: pnpm launch:check [options]

Options:
  --profile path       Production profile (default: .env.production.local)
  --skip-database      Skip migration, integrity, and retention checks
  --skip-containers    Skip Docker/Compose bundle validation (e.g. Vercel)
  --dry-run            Print the checks without executing them

This command is read-only. It never migrates, prunes, deploys, or sends data.`);
  process.exit(0);
}

const booleanFlags = new Set([
  "--skip-database",
  "--skip-containers",
  "--dry-run",
]);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (booleanFlags.has(arg)) continue;
  if (arg !== "--profile") {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
  if (!args[index + 1] || args[index + 1].startsWith("--")) {
    console.error("--profile requires a value.");
    process.exit(1);
  }
  index += 1;
}

const profileRelativePath = valueFor("profile") ?? ".env.production.local";
const profilePath = resolve(root, profileRelativePath);
const dryRun = args.includes("--dry-run");
let profile = {};
if (!dryRun) {
  if (!existsSync(profilePath)) {
    console.error(`Production profile not found: ${profileRelativePath}`);
    process.exit(1);
  }
  profile = parse(readFileSync(profilePath));
}

const checks = [
  {
    name: "Tracked product launch identity",
    command: ["pnpm", "config:check:prod", "--", "--file", profileRelativePath],
  },
  {
    name: "Production environment contract",
    command: ["pnpm", "env:check:prod", "--", "--file", profileRelativePath],
  },
  {
    name: "Migration policy",
    command: ["pnpm", "db:lint"],
  },
];

if (!args.includes("--skip-containers")) {
  checks.push({
    name: "Production container bundle",
    command: ["pnpm", "containers:check"],
  });
}

if (!args.includes("--skip-database")) {
  checks.push(
    {
      name: "Applied migration ledger",
      command: [process.execPath, "scripts/migrate.mjs", "--check"],
      database: true,
    },
    {
      name: "Relational integrity",
      command: ["pnpm", "db:integrity", "--", "--production"],
      database: true,
    },
    {
      name: "Retention preview",
      command: ["pnpm", "retention:report", "--", "--production"],
      database: true,
    },
  );
}

if (dryRun) {
  console.log(`Launch checks for ${profileRelativePath}:`);
  for (const check of checks) console.log(`- ${check.name}`);
  process.exit(0);
}

const databaseUrl = profile.MIGRATION_DATABASE_URL || profile.DATABASE_URL;
let failures = 0;
for (const check of checks) {
  console.log(`\n▸ ${check.name}`);
  if (check.database && !databaseUrl) {
    console.error("  MIGRATION_DATABASE_URL or DATABASE_URL is required.");
    failures += 1;
    continue;
  }

  const result = spawnSync(check.command[0], check.command.slice(1), {
    cwd: root,
    env: {
      ...process.env,
      ...profile,
      ...(check.database ? { DATABASE_URL: databaseUrl } : {}),
    },
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`  could not start check: ${result.error.message}`);
    failures += 1;
  } else if (result.status !== 0) {
    failures += 1;
  }
}

if (failures > 0) {
  console.error(
    `\nLaunch readiness failed: ${failures} check(s) need attention.`,
  );
  process.exit(1);
}

console.log(
  "\nLaunch readiness checks passed. Complete the manual release checklist before promotion.",
);
