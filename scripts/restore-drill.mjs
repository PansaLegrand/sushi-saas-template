#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

import {
  databaseConnectionParts,
  inspectRestoreTarget,
} from "./lib/database-operations.mjs";
import {
  resolvePostgresTool,
  spawnPostgresTool,
  waitForChild,
} from "./lib/postgres-tools.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const valueFor = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: pnpm db:restore:drill --backup file --confirm database

Restores a verified starter backup into RESTORE_DATABASE_URL. The target name
must contain restore, scratch, or drill; application, test, and Content Studio
databases are always refused. Existing objects inside the confirmed scratch
database are replaced.`);
  process.exit(0);
}

const allowed = new Set(["--backup", "--confirm"]);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (!allowed.has(arg)) {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
  if (!args[index + 1] || args[index + 1].startsWith("--")) {
    console.error(`${arg} requires a value.`);
    process.exit(1);
  }
  index += 1;
}

const backupArg = valueFor("backup");
const targetUrl = process.env.RESTORE_DATABASE_URL;
const inspection = inspectRestoreTarget(targetUrl ?? "", valueFor("confirm"));
if (!backupArg || !targetUrl || !inspection.ok) {
  if (!backupArg) console.error("--backup is required.");
  if (!targetUrl) console.error("RESTORE_DATABASE_URL is required.");
  for (const reason of inspection.reasons)
    console.error(`Restore target ${reason}.`);
  process.exit(1);
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const backupPath = resolve(process.cwd(), backupArg);
  const manifestPath = `${backupPath}.manifest.json`;
  if (!existsSync(backupPath) || !existsSync(manifestPath)) {
    throw new Error(
      "backup dump and matching .manifest.json are both required",
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.version !== 1 || manifest.format !== "postgres-custom") {
    throw new Error("unsupported backup manifest");
  }
  const checksum = await sha256(backupPath);
  if (checksum !== manifest.sha256) {
    throw new Error("backup checksum does not match its manifest");
  }

  const startedAt = Date.now();
  const tool = resolvePostgresTool("pg_restore", targetUrl, root);
  const child = spawnPostgresTool(
    tool,
    [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
    ],
    { cwd: root, stdio: ["pipe", "inherit", "inherit"] },
  );
  await Promise.all([
    waitForChild(child),
    pipeline(createReadStream(backupPath), child.stdin),
  ]);

  const migrationCheck = spawnSync(
    process.execPath,
    [resolve(root, "scripts/migrate.mjs"), "--check"],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: targetUrl },
      stdio: "inherit",
    },
  );
  if (migrationCheck.status !== 0) {
    throw new Error("restored database does not match the migration manifest");
  }

  const connection = databaseConnectionParts(targetUrl);
  const postgres = (await import("postgres")).default;
  const sql = postgres(targetUrl, { max: 1, prepare: false });
  let tableCount;
  try {
    const [row] = await sql`
      select count(*)::int as count
      from pg_catalog.pg_tables
      where schemaname not in ('pg_catalog', 'information_schema')
    `;
    tableCount = row?.count ?? 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
  if (tableCount < 1)
    throw new Error("restored database contains no application tables");

  const report = {
    version: 1,
    completedAt: new Date().toISOString(),
    backupCreatedAt: manifest.createdAt,
    sourceDatabase: manifest.database,
    targetDatabase: connection.database,
    checksum,
    tableCount,
    durationMs: Date.now() - startedAt,
    migrationCheck: "passed",
  };
  const reportPath = `${backupPath}.restore-report.json`;
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });

  console.log(`Restore drill passed.
  Target:    ${connection.database}
  Tables:    ${tableCount}
  Duration:  ${report.durationMs} ms
  Report:    ${reportPath}`);
}

main().catch((error) => {
  console.error("Restore drill failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
