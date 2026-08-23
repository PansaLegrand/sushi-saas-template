#!/usr/bin/env node
/** Validate one profile without logging any configured values. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "dotenv";

import {
  EnvValidationError,
  isStrongProductionSecret,
  validateAppEnv,
} from "../src/lib/env";
import { PROFILE_FILES, normalizeProfile } from "./lib/env-profile.mjs";

const args = process.argv.slice(2);
const profileArg = args.find((arg) => !arg.startsWith("--")) ?? "development";
const profile = normalizeProfile(profileArg);

if (!profile) {
  console.error(`Unknown environment: ${profileArg}`);
  process.exit(1);
}

const fileFlag = args.find((arg) => arg.startsWith("--file="));
const fileIndex = args.indexOf("--file");
const explicitFile =
  fileFlag?.slice("--file=".length) ??
  (fileIndex >= 0 ? args[fileIndex + 1] : undefined);
const fromProcess = args.includes("--process");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultAppCandidates =
  profile === "development"
    ? [PROFILE_FILES.development.app, ".env.local", ".env"]
    : [PROFILE_FILES.production.app];
const selectedAppFile =
  explicitFile ??
  defaultAppCandidates.find((path) => existsSync(resolve(root, path))) ??
  PROFILE_FILES[profile].app;
const profilePath = resolve(root, selectedAppFile);
let appValues: Record<string, string> = {};

if (!fromProcess) {
  if (!existsSync(profilePath)) {
    console.error(
      `Environment profile not found: ${profilePath}\n` +
        `Create it with: pnpm env:setup:${profile === "production" ? "prod" : "dev"}`,
    );
    process.exit(1);
  }

  // Remove every documented app key so the check cannot accidentally pass by
  // borrowing a credential from the caller's development shell.
  const documented = parse(readFileSync(resolve(root, ".env.example")));
  for (const key of [...Object.keys(documented), "AUTH_SECRET"]) {
    delete process.env[key];
  }
  appValues = parse(readFileSync(profilePath));
  Object.assign(process.env, appValues);
} else {
  appValues = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

Object.assign(process.env, { NODE_ENV: profile });
delete process.env.npm_lifecycle_event;
delete process.env.NEXT_PHASE;

function validateUrl(value: string | undefined, key: string, issues: string[]) {
  if (!value) {
    issues.push(key);
    return;
  }
  try {
    new URL(value);
  } catch {
    issues.push(`${key} (must be a valid URL)`);
  }
}

function validateStudioEnv(values: Record<string, string>) {
  const issues: string[] = [];
  validateUrl(values.CONTENT_DATABASE_URL, "CONTENT_DATABASE_URL", issues);
  validateUrl(values.CONTENT_STUDIO_URL, "CONTENT_STUDIO_URL", issues);
  validateUrl(values.SAAS_MARKETING_API_URL, "SAAS_MARKETING_API_URL", issues);

  if (!values.PAYLOAD_SECRET) {
    issues.push("PAYLOAD_SECRET");
  } else if (
    profile === "production" &&
    !isStrongProductionSecret(values.PAYLOAD_SECRET)
  ) {
    issues.push(
      "PAYLOAD_SECRET (use at least 32 random bytes, not a placeholder)",
    );
  }

  if (!values.CONTENT_CORS_ORIGINS) {
    issues.push("CONTENT_CORS_ORIGINS");
  } else {
    for (const origin of values.CONTENT_CORS_ORIGINS.split(",")) {
      validateUrl(
        origin.trim(),
        "CONTENT_CORS_ORIGINS (contains an invalid URL)",
        issues,
      );
    }
  }

  if (values.CONTENT_DATABASE_URL === appValues.DATABASE_URL) {
    issues.push("CONTENT_DATABASE_URL (must not reuse the SaaS DATABASE_URL)");
  }

  if (!values.CONTENT_MARKETING_SECRET) {
    issues.push("CONTENT_MARKETING_SECRET");
  } else if (
    values.CONTENT_MARKETING_SECRET !== appValues.CONTENT_MARKETING_SECRET
  ) {
    issues.push("CONTENT_MARKETING_SECRET (must match the SaaS profile)");
  }

  const storageKeys = [
    "CONTENT_STORAGE_BUCKET",
    "CONTENT_STORAGE_REGION",
    "CONTENT_STORAGE_ACCESS_KEY",
    "CONTENT_STORAGE_SECRET_KEY",
  ];
  if (storageKeys.some((key) => values[key])) {
    for (const key of storageKeys) {
      if (!values[key])
        issues.push(
          `${key} (required when Content Studio storage is configured)`,
        );
    }
  }

  return issues;
}

try {
  validateAppEnv();

  let studioChecked = false;
  if (!fromProcess) {
    const studioCandidates =
      profile === "development"
        ? [PROFILE_FILES.development.studio, "apps/content-studio/.env.local"]
        : [PROFILE_FILES.production.studio];
    const studioFile = studioCandidates.find((path) =>
      existsSync(resolve(root, path)),
    );
    if (studioFile) {
      studioChecked = true;
      const studioIssues = validateStudioEnv(
        parse(readFileSync(resolve(root, studioFile))),
      );
      if (studioIssues.length > 0) {
        throw new EnvValidationError(
          "Invalid Content Studio environment",
          studioIssues.map((issue) => `Content Studio: ${issue}`),
        );
      }
    }
  }

  console.log(
    `✓ ${profile} environment${studioChecked ? " and Content Studio" : ""} is valid${fromProcess ? "" : ` (${profilePath})`}`,
  );
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(`Invalid ${profile} environment:`);
    for (const issue of error.issues) console.error(`- ${issue}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
}
