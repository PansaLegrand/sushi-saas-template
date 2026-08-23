#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { build } from "esbuild";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const outIndex = args.indexOf("--out-dir");
const outDir = resolve(
  process.cwd(),
  outIndex >= 0 ? args[outIndex + 1] : ".data/runtime",
);
if (
  outIndex >= 0 &&
  (!args[outIndex + 1] || args[outIndex + 1].startsWith("--"))
) {
  console.error("--out-dir requires a value.");
  process.exit(1);
}
for (let index = 0; index < args.length; index += 1) {
  if (args[index] !== "--out-dir") {
    console.error(`Unknown option: ${args[index]}`);
    process.exit(1);
  }
  index += 1;
}

mkdirSync(outDir, { recursive: true });
const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  legalComments: "none",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
};

await build({
  ...shared,
  entryPoints: ["scripts/jobs-worker.ts"],
  outfile: resolve(outDir, "jobs-worker.mjs"),
  conditions: ["react-server"],
});
await build({
  ...shared,
  entryPoints: ["scripts/migrate.mjs"],
  outfile: resolve(outDir, "migrate.mjs"),
});

console.log(`Runtime bundles written to ${outDir}`);
