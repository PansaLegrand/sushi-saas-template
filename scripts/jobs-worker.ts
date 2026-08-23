#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDevelopmentAppProfile } from "./lib/profile-loader.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const once = process.argv.includes("--once");
const production = process.argv.includes("--production");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: pnpm jobs:work [--once] [--production]

Drains the durable jobs table with the same lease-safe runner used by HTTP cron.
Run continuously in a worker process, or pass --once for a single bounded drain.
Pass --production to enforce the complete production environment contract.

Configuration:
  JOB_WORKER_POLL_MS
  JOB_WORKER_BATCH_SIZE
  JOB_WORKER_HANDLER_TIMEOUT_MS
  JOB_WORKER_DRAIN_DEADLINE_MS
  JOB_WORKER_MAINTENANCE_INTERVAL_MS`);
  process.exit(0);
}

const unknownArgs = process.argv
  .slice(2)
  .filter((arg) => !["--", "--once", "--production"].includes(arg));
if (unknownArgs.length > 0) {
  console.error(`Unknown option: ${unknownArgs[0]}`);
  process.exit(1);
}

if (production) Object.assign(process.env, { NODE_ENV: "production" });

if (
  process.env.NODE_ENV !== "production" &&
  !process.env.DATABASE_URL?.trim()
) {
  loadDevelopmentAppProfile(root);
}

function positiveEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    console.error(`${name} must be a positive integer.`);
    process.exit(1);
  }
  return value;
}

if (!process.env.DATABASE_URL?.trim()) {
  console.error("DATABASE_URL is required. Run pnpm setup or export it first.");
  process.exit(1);
}

const controller = new AbortController();
let stopping = false;

function stop(signal: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; finishing the current job before stopping.`);
  controller.abort();
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

async function main() {
  const { runJobWorker } = await import("@/services/jobs/worker");
  const options = {
    signal: controller.signal,
    pollIntervalMs: positiveEnv("JOB_WORKER_POLL_MS", 2_000),
    batchSize: positiveEnv("JOB_WORKER_BATCH_SIZE", 25),
    handlerTimeoutMs: positiveEnv("JOB_WORKER_HANDLER_TIMEOUT_MS", 20_000),
    drainDeadlineMs: positiveEnv("JOB_WORKER_DRAIN_DEADLINE_MS", 40_000),
    maintenanceIntervalMs: positiveEnv(
      "JOB_WORKER_MAINTENANCE_INTERVAL_MS",
      300_000,
    ),
    once,
  };

  console.log(
    once
      ? "Running one bounded job queue drain."
      : `Job worker started; polling every ${options.pollIntervalMs}ms.`,
  );
  try {
    await runJobWorker(options);
    console.log("Job worker stopped cleanly.");
  } finally {
    const { closeDb } = await import("@/db");
    await closeDb();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      "Job worker stopped after an unrecoverable one-shot failure.",
    );
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
