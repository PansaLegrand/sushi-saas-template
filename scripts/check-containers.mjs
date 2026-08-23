#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const dockerfiles = [
  "Dockerfile.web",
  "Dockerfile.admin",
  "Dockerfile.worker",
  "Dockerfile.studio",
];
const issues = [];

for (const file of dockerfiles) {
  const contents = readFileSync(resolve(root, file), "utf8");
  if (
    !/^FROM node:20\.19\.5-alpine@sha256:[a-f0-9]{64} AS runner$/m.test(
      contents,
    )
  ) {
    issues.push(`${file} must pin the approved Node runner image`);
  }
  if (!/^USER \S+/m.test(contents)) {
    issues.push(`${file} must run as a non-root user`);
  }
  const startup = contents
    .split("\n")
    .filter((line) => /^(?:CMD|ENTRYPOINT)\b/.test(line));
  if (startup.some((line) => /migrat/i.test(line))) {
    issues.push(`${file} must not run migrations during container startup`);
  }
}

const workerDockerfile = readFileSync(
  resolve(root, "Dockerfile.worker"),
  "utf8",
);
if (!workerDockerfile.includes("pnpm bundle:runtime")) {
  issues.push("Dockerfile.worker must compile the worker and migration runner");
}
if (/COPY[^\n]+node_modules/.test(workerDockerfile)) {
  issues.push("Dockerfile.worker final image must not copy node_modules");
}

const dockerignore = readFileSync(resolve(root, ".dockerignore"), "utf8");
if (!dockerignore.split("\n").includes(".env*")) {
  issues.push(".dockerignore must exclude environment profiles");
}

for (const file of [
  "next.config.ts",
  "apps/admin/next.config.ts",
  "apps/content-studio/next.config.ts",
]) {
  if (
    !/output:\s*["']standalone["']/.test(
      readFileSync(resolve(root, file), "utf8"),
    )
  ) {
    issues.push(`${file} must enable standalone output`);
  }
}

if (issues.length > 0) {
  console.error("Container bundle policy failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

const compose = spawnSync(
  "docker",
  [
    "compose",
    "--env-file",
    ".env.example",
    "--profile",
    "studio",
    "-f",
    "compose.production.yml",
    "config",
    "--quiet",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      APP_ENV_FILE: ".env.example",
      CONTENT_ENV_FILE: "apps/content-studio/.env.example",
    },
    stdio: "inherit",
  },
);
if (compose.error?.code === "ENOENT") {
  console.error(
    "Docker Compose is required to validate compose.production.yml.",
  );
  process.exit(1);
}
if (compose.status !== 0) process.exit(compose.status ?? 1);

console.log("Container Dockerfiles and production Compose bundle are valid.");
