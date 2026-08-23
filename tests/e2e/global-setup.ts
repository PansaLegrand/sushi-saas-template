import { spawnSync } from "node:child_process";

export default async function globalSetup() {
  if (process.env.E2E_SKIP_SEED === "1" || process.env.E2E_BASE_URL) return;

  const seeded = spawnSync("pnpm", ["dev:seed"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(process.env.E2E_BASE_URL
        ? {}
        : {
            DATABASE_URL: "postgresql://sushi:sushi@localhost:5432/sushi_dev",
          }),
    },
    stdio: "inherit",
  });

  if (seeded.status !== 0) {
    throw new Error(
      "Playwright could not prepare the local demo fixture. Run pnpm setup and pnpm dev:doctor first.",
    );
  }
}
