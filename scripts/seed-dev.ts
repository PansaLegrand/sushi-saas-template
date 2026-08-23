#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectDevelopmentDatabaseUrl } from "./lib/dev-safety.mjs";
import { loadDevelopmentAppProfile } from "./lib/profile-loader.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((arg) => arg !== "--");

function valueFor(name: string) {
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: pnpm dev:seed [--email address] [--credits amount]

Creates or repairs one verified Better Auth demo account, its personal
organization, an idempotent credit grant, and the demo reservation service.

Credentials:
  email     demo@example.test (must end in .test or .invalid)
  password  DEV_SEED_PASSWORD or DemoPass123!`);
  process.exit(0);
}

async function main() {
  const profile = loadDevelopmentAppProfile(root);
  if (!profile) {
    console.error("Development profile is missing. Run pnpm setup first.");
    process.exit(1);
  }

  const safety = inspectDevelopmentDatabaseUrl(
    process.env.DATABASE_URL ?? "",
    "sushi_dev",
  );
  if (!safety.ok) {
    console.error(
      "Refusing to seed: DATABASE_URL is not the local sushi_dev database.",
    );
    for (const reason of safety.reasons) console.error(`- ${reason}`);
    process.exit(1);
  }

  const email = (valueFor("email") ?? "demo@example.test").trim().toLowerCase();
  if (!/@[^@]+\.(?:test|invalid)$/.test(email)) {
    console.error("Seed email must use a reserved .test or .invalid domain.");
    process.exit(1);
  }

  const credits = Number(valueFor("credits") ?? 1000);
  if (!Number.isSafeInteger(credits) || credits < 1 || credits > 100_000) {
    console.error("--credits must be an integer between 1 and 100000.");
    process.exit(1);
  }

  const customPassword = process.env.DEV_SEED_PASSWORD?.trim();
  const password = customPassword || "DemoPass123!";
  if (password.length < 8) {
    console.error("DEV_SEED_PASSWORD must contain at least 8 characters.");
    process.exit(1);
  }

  // Never let fixture creation send email or require a browser captcha. These
  // overrides are process-local and do not modify the profile.
  Object.assign(process.env, {
    NEXT_PUBLIC_CAPTCHA_ENABLED: "false",
    AUTH_DEV_EMAIL_LINKS: "true",
    RESEND_API_KEY: "",
  });

  const fixtures = await import("../src/services/dev-fixtures");
  let user = await fixtures.findDevelopmentFixtureUser(email);
  if (!user) {
    const { auth } = await import("../src/lib/auth");
    await auth.api.signUpEmail({
      body: { email, password, name: "Demo User" } as never,
      headers: new Headers(),
    });
    user = await fixtures.findDevelopmentFixtureUser(email);
  }

  if (!user) {
    console.error("Better Auth did not create the development fixture user.");
    process.exit(1);
  }

  const result = await fixtures.seedDevelopmentFixtures({ email, credits });
  console.log(`
Development fixtures are ready.

  Web:          http://localhost:3000
  Email:        ${email}
  Password:     ${customPassword ? "set by DEV_SEED_PASSWORD" : password}
  Organization: ${result.organization.slug}
  Credits:      ${result.credit?.credits ?? credits}
  Reservation:  ${result.reservationService.slug}

Re-running this command is safe; it repairs missing fixtures without issuing a
second credit grant.
`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Could not seed development fixtures.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
