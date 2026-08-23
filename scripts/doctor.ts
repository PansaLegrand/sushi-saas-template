#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GetBucketCorsCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { EnvValidationError, validateAppEnv } from "../src/lib/env";
import {
  inspectDevelopmentDatabaseUrl,
  inspectDevelopmentRedisUrl,
  inspectDevelopmentStorage,
} from "./lib/dev-safety.mjs";
import {
  DEVELOPMENT_STUDIO_FILES,
  loadDevelopmentAppProfile,
  readFirstProfile,
} from "./lib/profile-loader.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: pnpm dev:doctor

Runs read-only checks for the toolchain, environment profiles, local
infrastructure, migrations, object storage, and optional developer tools.`);
  process.exit(0);
}

const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as {
  packageManager: string;
  engines: { node: string; pnpm: string };
};

let failures = 0;
let warnings = 0;
const ok = (message: string) => console.log(`  \x1b[32m✓\x1b[0m ${message}`);
const info = (message: string) => console.log(`  \x1b[36m·\x1b[0m ${message}`);
const warn = (message: string) => {
  warnings += 1;
  console.log(`  \x1b[33m!\x1b[0m ${message}`);
};
const fail = (message: string) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${message}`);
};
const heading = (message: string) => console.log(`\n\x1b[1m${message}\x1b[0m`);

function hasCommand(command: string) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

function probePort(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (result: boolean) => {
      socket.destroy();
      done(result);
    };
    socket.setTimeout(1_000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function composeCheck(service: string, command: string[]) {
  return (
    spawnSync("docker", ["compose", "exec", "-T", service, ...command], {
      cwd: root,
      stdio: "ignore",
    }).status === 0
  );
}

async function main() {
  heading("Toolchain");
  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  if (nodeMajor > 20 || (nodeMajor === 20 && nodeMinor >= 19)) {
    if (nodeMajor < 23)
      ok(`Node ${process.versions.node} (${packageJson.engines.node})`);
    else
      fail(
        `Node ${process.versions.node} is outside ${packageJson.engines.node}`,
      );
  } else {
    fail(
      `Node ${process.versions.node} is outside ${packageJson.engines.node}`,
    );
  }

  const pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  const expectedPnpm = packageJson.packageManager.split("@")[1];
  if (pnpm.status === 0 && pnpm.stdout.trim() === expectedPnpm) {
    ok(`pnpm ${pnpm.stdout.trim()}`);
  } else if (pnpm.status === 0) {
    fail(`pnpm ${pnpm.stdout.trim()} is installed; expected ${expectedPnpm}`);
  } else {
    fail("pnpm is not installed");
  }

  heading("Configuration");
  const profile = loadDevelopmentAppProfile(root);
  if (!profile) {
    fail("development profile is missing; run pnpm env:setup:dev");
  } else {
    ok(`using ${profile.relativePath}`);
    if ((statSync(profile.path).mode & 0o077) === 0)
      ok("profile permissions are private (0600)");
    else warn(`tighten ${profile.relativePath} permissions with chmod 600`);

    try {
      validateAppEnv();
      ok("application environment values are well formed");
    } catch (error) {
      if (error instanceof EnvValidationError) {
        for (const issue of error.issues) fail(`environment: ${issue}`);
      } else {
        fail("application environment validation crashed");
      }
    }

    for (const [name, result] of [
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
    ] as const) {
      if (result.ok) ok(`${name} points at the expected local service`);
      else for (const reason of result.reasons) fail(`${name} ${reason}`);
    }

    if (process.env.RESTORE_DATABASE_URL) {
      const restoreDatabase = inspectDevelopmentDatabaseUrl(
        process.env.RESTORE_DATABASE_URL,
        "sushi_restore_drill",
      );
      if (restoreDatabase.ok) {
        ok("RESTORE_DATABASE_URL points at the isolated local drill database");
      } else {
        for (const reason of restoreDatabase.reasons) {
          fail(`RESTORE_DATABASE_URL ${reason}`);
        }
      }
    } else {
      info("RESTORE_DATABASE_URL is optional until running a restore drill");
    }

    if (process.env.STORAGE_PROVIDER === "garage") {
      const storage = inspectDevelopmentStorage(process.env);
      if (storage.ok)
        ok("local object storage points at the bundled Garage service");
      else
        for (const reason of storage.reasons)
          fail(`local object storage ${reason}`);
    } else {
      info(
        `external ${process.env.STORAGE_PROVIDER || "s3"} storage is configured; bundled Garage checks are skipped`,
      );
      for (const key of [
        "STORAGE_BUCKET",
        "STORAGE_ACCESS_KEY",
        "STORAGE_SECRET_KEY",
      ]) {
        if (!process.env[key]) fail(`${key} is required for external storage`);
      }
    }

    const studio = readFirstProfile(root, DEVELOPMENT_STUDIO_FILES);
    if (!studio) {
      fail("Content Studio development profile is missing");
    } else {
      ok(`using ${studio.relativePath}`);
      if (studio.values.CONTENT_DATABASE_URL === process.env.DATABASE_URL) {
        fail("Content Studio must not reuse the SaaS database");
      }
      const studioDatabase = inspectDevelopmentDatabaseUrl(
        studio.values.CONTENT_DATABASE_URL ?? "",
        "sushi_content",
      );
      if (!studioDatabase.ok) {
        for (const reason of studioDatabase.reasons) {
          fail(`CONTENT_DATABASE_URL ${reason}`);
        }
      }
      if (
        studio.values.CONTENT_MARKETING_SECRET !==
        process.env.CONTENT_MARKETING_SECRET
      ) {
        fail("Content Studio marketing secret does not match the SaaS profile");
      } else {
        ok("Content Studio database and shared secret boundaries are valid");
      }
    }
  }

  heading("Local services");
  if (!hasCommand("docker")) {
    fail("Docker is not installed");
  } else if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    fail("Docker is installed but the daemon is not running");
  } else {
    ok("Docker daemon is available");
    if (
      composeCheck("postgres", ["pg_isready", "-U", "sushi", "-d", "sushi_dev"])
    ) {
      ok("PostgreSQL is ready");
      if (profile) {
        const migrations = spawnSync(
          "node",
          ["scripts/migrate.mjs", "--check"],
          {
            cwd: root,
            env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
            stdio: "ignore",
          },
        );
        if (migrations.status === 0)
          ok("database migrations match this checkout");
        else
          fail(
            "database migrations are pending or drifted; run pnpm db:migrate",
          );
      }
    } else fail("PostgreSQL is not ready; run pnpm db:up");
    if (composeCheck("redis", ["redis-cli", "ping"])) ok("Redis is ready");
    else fail("Redis is not ready; run pnpm db:up");

    if (process.env.STORAGE_PROVIDER === "garage") {
      if (await probePort(3900))
        ok("local S3 API is listening on 127.0.0.1:3900");
      else fail("local S3 API is not listening; run pnpm infra:up");
    }
  }

  if (
    profile &&
    process.env.STORAGE_PROVIDER === "garage" &&
    inspectDevelopmentStorage(process.env).ok
  ) {
    try {
      const client = new S3Client({
        region: process.env.STORAGE_REGION ?? "garage",
        endpoint: process.env.STORAGE_ENDPOINT,
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.STORAGE_ACCESS_KEY ?? "",
          secretAccessKey: process.env.STORAGE_SECRET_KEY ?? "",
        },
      });
      await client.send(
        new HeadBucketCommand({ Bucket: process.env.STORAGE_BUCKET }),
      );
      ok("local S3 credentials can access the private development bucket");
      const cors = await client.send(
        new GetBucketCorsCommand({ Bucket: process.env.STORAGE_BUCKET }),
      );
      const supportsBrowserUpload = (origin: string) =>
        cors.CORSRules?.some(
          (rule) =>
            rule.AllowedOrigins?.length === 1 &&
            rule.AllowedOrigins.includes(origin) &&
            rule.AllowedMethods?.includes("PUT"),
        );
      if (
        supportsBrowserUpload("http://localhost:3000") &&
        supportsBrowserUpload("http://localhost:3100")
      )
        ok("local S3 bucket allows browser uploads from the web app");
      else fail("local S3 CORS is incomplete; rerun pnpm setup");
    } catch {
      fail("local S3 bucket is unavailable; rerun pnpm setup");
    }
  }

  heading("Optional integrations");
  if (hasCommand("stripe")) ok("Stripe CLI is available");
  else
    info("Stripe CLI not installed (needed only for local billing webhooks)");

  for (const [name, port] of [
    ["web", 3000],
    ["admin", 3001],
    ["studio", 3002],
  ] as const) {
    if (await probePort(port)) info(`${name} is running on port ${port}`);
    else info(`${name} is not running`);
  }

  console.log("");
  if (failures > 0) {
    console.log(
      `\x1b[31mDoctor found ${failures} problem(s) and ${warnings} warning(s).\x1b[0m`,
    );
    process.exit(1);
  }
  console.log(
    `\x1b[32mDoctor found no problems${warnings ? ` and ${warnings} warning(s)` : ""}.\x1b[0m`,
  );
}

main().catch((error) => {
  console.error("Developer doctor failed unexpectedly.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
