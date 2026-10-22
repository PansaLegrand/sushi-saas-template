#!/usr/bin/env node
import { scaffoldDomain } from "./lib/domain-scaffold.mjs";
const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.length === 0 || args.includes("--help")) {
  console.log(
    "Usage: pnpm scaffold:domain <kebab-case-name> [--dry-run]\nCreates a disabled, authenticated horizontal scaffold. Complete its contract before enabling it.",
  );
  process.exit(0);
}
if (args.length > 2 || (args[1] && args[1] !== "--dry-run"))
  throw new Error("Unexpected option. Use --help.");
for (const file of scaffoldDomain(
  process.cwd(),
  args[0],
  args.includes("--dry-run"),
))
  console.log(file);
