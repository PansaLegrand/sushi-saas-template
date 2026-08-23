#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { loadDevelopmentAppProfile } from "./lib/profile-loader.mjs";
import {
  databaseConnectionParts,
  safeBackupLabel,
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
  console.log(`Usage: pnpm db:backup [--output-dir path] [--label name]

Creates a PostgreSQL custom-format dump, SHA-256 manifest, and no plaintext
credentials. Uses BACKUP_DATABASE_URL, then DATABASE_URL. The bundled Docker
Postgres client is used when pg_dump is not installed on the host.`);
  process.exit(0);
}

const allowed = new Set(["--output-dir", "--label"]);
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

if (!process.env.BACKUP_DATABASE_URL && !process.env.DATABASE_URL) {
  loadDevelopmentAppProfile(root);
}
const databaseUrl = process.env.BACKUP_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("BACKUP_DATABASE_URL or DATABASE_URL is required.");
  process.exit(1);
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const connection = databaseConnectionParts(databaseUrl);
  const outputDir = resolve(root, valueFor("output-dir") ?? ".data/backups");
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const label = safeBackupLabel(valueFor("label") ?? connection.database);
  const finalPath = resolve(outputDir, `${label}-${timestamp}.dump`);
  const temporaryPath = resolve(outputDir, `.${label}-${randomUUID()}.partial`);
  const tool = resolvePostgresTool("pg_dump", databaseUrl, root);
  const output = createWriteStream(temporaryPath, { mode: 0o600, flags: "wx" });

  try {
    const child = spawnPostgresTool(
      tool,
      ["--format=custom", "--compress=6", "--no-owner", "--no-privileges"],
      { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
    );
    await Promise.all([waitForChild(child), pipeline(child.stdout, output)]);
    renameSync(temporaryPath, finalPath);
    chmodSync(finalPath, 0o600);
  } catch (error) {
    output.destroy();
    rmSync(temporaryPath, { force: true });
    throw error;
  }

  const checksum = await sha256(finalPath);
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    database: connection.database,
    file: finalPath.split("/").at(-1),
    bytes: statSync(finalPath).size,
    sha256: checksum,
    format: "postgres-custom",
  };
  const manifestPath = `${finalPath}.manifest.json`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });

  console.log(`Backup complete.
  Database: ${connection.database}
  Dump:     ${finalPath}
  Manifest: ${manifestPath}
  SHA-256:  ${checksum}`);
}

main().catch((error) => {
  console.error("Backup failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
