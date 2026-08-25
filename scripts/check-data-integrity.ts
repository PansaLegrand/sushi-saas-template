#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDevelopmentAppProfile } from "./lib/profile-loader.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((arg) => arg !== "--");

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: pnpm db:integrity [--production]

Runs read-only relationship and value checks for high-value auth, tenancy,
tenant-owned data, and pending schema-tightening work.`);
  process.exit(0);
}
for (const arg of args) {
  if (arg !== "--production") {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
}

if (args.includes("--production")) {
  Object.assign(process.env, { NODE_ENV: "production" });
}
if (
  !process.env.DATABASE_URL?.trim() &&
  process.env.NODE_ENV !== "production"
) {
  loadDevelopmentAppProfile(root);
}
if (!process.env.DATABASE_URL?.trim()) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

async function main() {
  const { checkDataIntegrity } = await import("@/services/integrity");
  try {
    const report = await checkDataIntegrity();
    console.log(`Data integrity: ${report.checks} checks`);
    if (!report.healthy) {
      for (const finding of report.findings) {
        console.error(
          `  FAIL ${finding.check}: ${finding.count} affected row(s)`,
        );
      }
      process.exitCode = 1;
    } else {
      console.log("  no integrity findings");
    }
  } finally {
    const { closeDb } = await import("@/db");
    await closeDb();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error("Data-integrity check failed.");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
