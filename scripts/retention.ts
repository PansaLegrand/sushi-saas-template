#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDevelopmentAppProfile } from "./lib/profile-loader.mjs";
import { parsePostgresUrl } from "./lib/database-operations.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const apply = args.includes("--apply");
const production = args.includes("--production");
const valueFor = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: pnpm retention:report
       pnpm retention:apply --confirm database [--production]

Reports operational rows older than the configured policy. --apply deletes only
finished jobs, provider receipts, auth events, and admin audit logs. Financial,
subscription, user-content, and product tables are never part of this command.`);
  process.exit(0);
}

const allowed = new Set(["--apply", "--production", "--confirm"]);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (!allowed.has(arg)) {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
  if (arg === "--confirm") {
    if (!args[index + 1] || args[index + 1].startsWith("--")) {
      console.error("--confirm requires a value.");
      process.exit(1);
    }
    index += 1;
  }
}

if (production) Object.assign(process.env, { NODE_ENV: "production" });
if (!process.env.DATABASE_URL?.trim() && !production) {
  loadDevelopmentAppProfile(root);
}
const parsed = parsePostgresUrl(process.env.DATABASE_URL ?? "");
if (!parsed) {
  console.error("DATABASE_URL must be a valid PostgreSQL URL.");
  process.exit(1);
}
const databaseName = parsed.database;
if (apply && valueFor("confirm") !== databaseName) {
  console.error(`--confirm must exactly equal ${databaseName}.`);
  process.exit(1);
}

function printReport(
  report: Awaited<
    ReturnType<typeof import("@/services/retention").getRetentionReport>
  >,
) {
  console.log(`Retention report for ${databaseName}`);
  for (const key of Object.keys(report.candidates) as Array<
    keyof typeof report.candidates
  >) {
    const candidate = report.candidates[key];
    const cutoff = report.cutoffs[key];
    console.log(
      `  ${key.padEnd(25)} ${String(candidate.count).padStart(8)} before ${cutoff.toISOString()}`,
    );
  }
}

async function main() {
  const retention = await import("@/services/retention");
  try {
    const operationAt = new Date();
    const report = await retention.getRetentionReport(operationAt);
    printReport(report);
    if (!apply) {
      console.log(
        "Dry run only. Use retention:apply with exact confirmation to delete.",
      );
      return;
    }

    const result = await retention.applyRetentionPolicy(operationAt);
    console.log("Deleted rows:");
    for (const [key, count] of Object.entries(result.deleted)) {
      console.log(`  ${key.padEnd(25)} ${String(count).padStart(8)}`);
    }
  } finally {
    const { closeDb } = await import("@/db");
    await closeDb();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Retention command failed.");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
