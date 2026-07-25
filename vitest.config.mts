import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Pull exactly one variable out of the local env files.
 *
 * Deliberately not `dotenv.config()`. Loading the whole file would let every
 * test see the developer's personal environment, and a test that happens to
 * read an env var it did not stub would then pass on one machine and fail on
 * another. The mocked tiers must stay hermetic — TEST_DATABASE_URL is the only
 * value a test file is allowed to learn from `.env`, and only the database tier
 * reads it. An explicit shell/CI value always wins.
 */
function loadTestDatabaseUrl(): void {
  if (process.env.TEST_DATABASE_URL?.trim()) return;

  for (const file of [".env", ".env.local"]) {
    const filePath = path.resolve(__dirname, file);
    if (!fs.existsSync(filePath)) continue;
    const value = parse(fs.readFileSync(filePath)).TEST_DATABASE_URL?.trim();
    if (value) process.env.TEST_DATABASE_URL = value;
  }
}

loadTestDatabaseUrl();

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@/app": path.resolve(__dirname, "src/app"),
      "@admin": path.resolve(__dirname, "apps/admin"),
      "server-only": path.resolve(__dirname, "tests/shims/server-only.ts"),
    },
    projects: [
      {
        extends: true,
        test: {
          name: "mocked",
          // `.ts` only, so the component tier's `.tsx` files cannot be pulled
          // into a Node environment where `document` does not exist.
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/db/**", "tests/components/**"],
        },
      },
      {
        extends: true,
        // The root tsconfig sets `jsx: "preserve"` because Next does its own
        // JSX compilation. Vitest transforms with esbuild, which honours that
        // and emits raw JSX the runner cannot execute. Overriding it here is
        // enough — `@vitejs/plugin-react` would also work but exists mainly for
        // Fast Refresh, which no test needs.
        esbuild: { jsx: "automatic", jsxImportSource: "react" },
        test: {
          name: "components",
          environment: "jsdom",
          include: ["tests/components/**/*.test.tsx"],
          setupFiles: ["tests/components/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          // One database, shared by every file in this tier, and each file
          // truncates the same tables between tests. Run them in parallel and
          // one file's `beforeEach` wipes rows another file is mid-assertion
          // on — which shows up as tests that pass and fail on alternate runs.
          //
          // A single fork forces the files through one worker, one after the
          // other. `fileParallelism: false` looks like the obvious knob but is
          // root-only in Vitest 3 and is silently ignored here; this is the
          // project-level equivalent. The mocked project stays parallel.
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov"],
      reportsDirectory: "coverage",
      // Scoped on purpose. A repo-wide percentage is dominated by pages and
      // components — it moves when you add UI and says nothing about whether
      // the logic that handles money and auth is tested. These four trees are
      // the ones where a bug is expensive.
      include: [
        "src/services/**/*.ts",
        "src/models/**/*.ts",
        "src/lib/**/*.ts",
        "src/app/api/**/*.ts",
        "apps/admin/lib/**/*.ts",
      ],
      exclude: [
        "**/*.d.ts",
        // Config surfaces, not logic: no branches worth asserting.
        "src/lib/source.ts",
        "src/services/page-loader.ts",
      ],
      // A ratchet, not a target. Raise these when a run comes in above them;
      // never lower one to make a red build green — that is the signal working.
      // Calibrated against a fresh clone with no test database — the floor
      // every contributor can meet without installing Postgres. Measured there:
      // 26.15 / 42.4 / 64.09. A run with TEST_DATABASE_URL set (CI always) comes
      // in around 34.5 / 56 / 66; that is headroom, not a reason to relax these.
      thresholds: {
        lines: 25,
        functions: 41,
        branches: 62,
        statements: 25,
      },
    },
  },
});
