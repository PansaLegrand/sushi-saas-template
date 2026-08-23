#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectMigrationDirectory } from "./migration-policy.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const findings = inspectMigrationDirectory(resolve(root, "src/db/migrations"));

if (findings.length > 0) {
  console.error("Migration safety policy failed:");
  for (const finding of findings) {
    console.error(
      `- ${finding.file ?? "migration"}: [${finding.rule}] ${finding.message}`,
    );
  }
  console.error(
    "\nIf the staged rollout is intentional, add: " +
      "-- migration-safety: allow <rule> - <reviewable reason>",
  );
  process.exit(1);
}

console.log("Migration journal and safety policy passed.");
