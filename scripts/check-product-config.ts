#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "dotenv";

import { getProductConfigIssues, productConfig } from "@/config/product";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const production = args.includes("--production");
const fileIndex = args.indexOf("--file");
const explicitFile = fileIndex >= 0 ? args[fileIndex + 1] : undefined;

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: pnpm config:check
       pnpm config:check:prod [--file .env.production.local]

Validates saas.config.json. The production gate also rejects neutral identity,
missing support/legal identity, and contradictory public environment values.`);
  process.exit(0);
}
const allowed = new Set(["--production", "--file"]);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (!allowed.has(arg)) {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  }
  if (arg === "--file") {
    if (!args[index + 1] || args[index + 1].startsWith("--")) {
      console.error("--file requires a value.");
      process.exit(1);
    }
    index += 1;
  }
}

let environment: Record<string, string> = {};
if (production || explicitFile) {
  const relativePath = explicitFile ?? ".env.production.local";
  const path = resolve(root, relativePath);
  if (!existsSync(path)) {
    console.error(`Production profile not found: ${relativePath}`);
    process.exit(1);
  }
  environment = parse(readFileSync(path));
}

const issues = getProductConfigIssues(productConfig, {
  production,
  environment,
});
if (issues.length > 0) {
  console.error("Product configuration is not ready:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(
  `Product configuration is valid${production ? " for production" : ""}.`,
);
