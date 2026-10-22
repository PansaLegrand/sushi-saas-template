/** The advertised Core start command must run its own worker on a clean clone. */
import { defineConfig, devices } from "@playwright/test";

import {
  inspectDevelopmentDatabaseUrl,
  inspectDevelopmentRedisUrl,
  inspectDevelopmentStorage,
} from "./scripts/lib/dev-safety.mjs";
import { loadDevelopmentAppProfile } from "./scripts/lib/profile-loader.mjs";

if (
  process.env.E2E_ALLOW_MUTATIONS !== "1" ||
  process.env.E2E_BASE_URL ||
  process.env.NODE_ENV === "production"
) {
  throw new Error(
    "Core onboarding requires E2E_ALLOW_MUTATIONS=1 in a fresh disposable local checkout; external or production targets are forbidden.",
  );
}
if (!loadDevelopmentAppProfile(process.cwd())) {
  throw new Error(
    "Run pnpm starter core setup in the disposable checkout first.",
  );
}
for (const result of [
  inspectDevelopmentDatabaseUrl(process.env.DATABASE_URL ?? "", "sushi_dev"),
  inspectDevelopmentRedisUrl(process.env.RATE_LIMIT_REDIS_URL ?? ""),
  inspectDevelopmentStorage(process.env),
]) {
  if (!result.ok) {
    throw new Error(
      "Core onboarding refuses non-local database, Redis, or storage configuration.",
    );
  }
}

const baseURL = "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "core-onboarding.smoke.ts",
  outputDir: "./test-results/core-onboarding",
  fullyParallel: false,
  workers: 1,
  // A retry would reuse the changed ledger and disguise a first-run failure.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report/core" }],
      ]
    : [
        ["list"],
        ["html", { open: "never", outputFolder: "playwright-report/core" }],
      ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "pnpm starter core demo",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NEXT_PUBLIC_WEB_URL: baseURL,
      BETTER_AUTH_URL: baseURL,
      NEXT_PUBLIC_AUTH_BASE_URL: baseURL,
    },
  },
});
