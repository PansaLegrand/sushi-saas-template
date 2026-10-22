#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { starterCommands, starterProfile } from "./lib/starter-profiles.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.includes("--help") || args.length === 0) {
  console.log(
    "Usage: pnpm starter <core|operations|publishing> <install|setup|doctor|dev|build|lint> [--dry-run]\n\nProfiles select local tools and build targets; they do not disable runtime routes or change plan entitlements.",
  );
  process.exit(0);
}
if (args.length > 3 || (args[2] && args[2] !== "--dry-run"))
  throw new Error("Unexpected argument. Use pnpm starter --help.");
const profile = args[0] === "--current" ? starterProfile() : starterProfile(args[0]);
const commands = starterCommands(profile, args[1]);
for (const command of commands) {
  console.log(`[${profile.name}] pnpm ${command.join(" ")}`);
  if (args.includes("--dry-run")) continue;
  const result = spawnSync("pnpm", command, {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
    env: { ...process.env, SAAS_STARTER_PROFILE: profile.name },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
