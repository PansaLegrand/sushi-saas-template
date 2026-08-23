#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2).filter((arg) => arg !== "--"));

if (args.has("--help") || args.has("-h")) {
  console.log(`Usage: pnpm dev:all [options]

Options:
  --web-only     Start only the SaaS web application
  --no-worker    Do not start the durable job worker
  --no-admin     Do not start the admin console
  --no-studio    Do not start Content Studio
  --with-stripe  Also forward Stripe webhooks with the Stripe CLI
  --skip-doctor  Skip the read-only environment preflight
  -h, --help     Show this help`);
  process.exit(0);
}

const knownArgs = new Set([
  "--web-only",
  "--no-worker",
  "--no-admin",
  "--no-studio",
  "--with-stripe",
  "--skip-doctor",
]);
for (const arg of args) {
  if (!knownArgs.has(arg)) {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
}

if (!args.has("--skip-doctor")) {
  const doctor = spawnSync("pnpm", ["dev:doctor"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (doctor.status !== 0) {
    console.error(
      "\nDeveloper preflight failed. Fix the findings or pass --skip-doctor deliberately.",
    );
    process.exit(doctor.status ?? 1);
  }
}

const commands = [{ name: "web", command: "pnpm", args: ["dev:web"] }];
if (!args.has("--web-only") && !args.has("--no-worker")) {
  commands.push({ name: "worker", command: "pnpm", args: ["jobs:work"] });
}
if (!args.has("--web-only") && !args.has("--no-admin")) {
  commands.push({ name: "admin", command: "pnpm", args: ["dev:admin"] });
}
if (!args.has("--web-only") && !args.has("--no-studio")) {
  commands.push({ name: "studio", command: "pnpm", args: ["dev:studio"] });
}
if (args.has("--with-stripe")) {
  if (spawnSync("stripe", ["--version"], { stdio: "ignore" }).status !== 0) {
    console.error(
      "Stripe CLI was requested but is not installed or not available in PATH.",
    );
    process.exit(1);
  }
  commands.push({
    name: "stripe",
    command: "bash",
    args: ["scripts/stripe-listen.sh"],
  });
}

const colors = [36, 34, 35, 33, 32];
const children = new Map();
let shuttingDown = false;
let exitCode = 0;

function prefixStream(stream, name, color) {
  const lines = createInterface({ input: stream });
  lines.on("line", (line) => {
    process.stdout.write(`\x1b[${color}m[${name.padEnd(6)}]\x1b[0m ${line}\n`);
  });
}

function stopAll(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;

  for (const child of children.values()) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }

  const forceTimer = setTimeout(() => {
    for (const child of children.values()) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  }, 5_000);
  forceTimer.unref();
}

for (const [index, spec] of commands.entries()) {
  const child = spawn(spec.command, spec.args, {
    cwd: root,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });
  children.set(spec.name, child);
  prefixStream(child.stdout, spec.name, colors[index % colors.length]);
  prefixStream(child.stderr, spec.name, colors[index % colors.length]);

  child.on("error", (error) => {
    console.error(`[${spec.name}] failed to start: ${error.message}`);
    stopAll(1);
  });
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `[${spec.name}] exited${signal ? ` from ${signal}` : ` with code ${code ?? 1}`}; stopping the remaining processes.`,
      );
      stopAll(code ?? 1);
    }

    if (
      [...children.values()].every(
        (candidate) =>
          candidate.exitCode !== null || candidate.signalCode !== null,
      )
    ) {
      process.exit(exitCode);
    }
  });
}

console.log(
  `Starting ${commands.map((command) => command.name).join(", ")}. Press Ctrl-C to stop all processes.`,
);
process.on("SIGINT", () => stopAll(130));
process.on("SIGTERM", () => stopAll(143));
