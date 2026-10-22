#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  starterCommands,
  starterEnvironment,
  starterProfile,
} from "./lib/starter-profiles.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.includes("--help") || args.length === 0) {
  console.log(
    "Usage: pnpm starter <core|operations|publishing> <install|setup|doctor|demo|dev|build|lint> [--dry-run]\n\nProfiles select local tools and build targets; they do not disable runtime routes or change plan entitlements.\n\nDemo seeds the guarded local database and starts the selected apps plus worker with the local image mock. Captcha, email, Slack, and Stripe are disabled for this process only; environment files are unchanged.",
  );
  process.exit(0);
}
if (args.length > 3 || (args[2] && args[2] !== "--dry-run"))
  throw new Error("Unexpected argument. Use pnpm starter --help.");
const profile =
  args[0] === "--current" ? starterProfile() : starterProfile(args[0]);
const commands = starterCommands(profile, args[1]);
const environment = starterEnvironment(profile, args[1]);
if (args[1] === "demo") {
  console.log(
    "Local demo: seeded account and mock image provider. No external image generation, email, Slack, or Stripe.\nAfter startup, open http://localhost:3000/en/tasks/image-generation. Use the demo credentials printed by the seed command.\nStop with Ctrl-C, then use the dev action for your normal integrations.",
  );
}
for (const command of commands) {
  console.log(`[${profile.name}] pnpm ${command.join(" ")}`);
  if (args.includes("--dry-run")) continue;
  const result = spawnSync("pnpm", command, {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
    env: { ...process.env, ...environment },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
