/**
 * Executable version of the layering rules in AGENTS.md.
 *
 * Documentation describing an architecture decays the moment someone is in a
 * hurry. These tests fail the build instead, which is the only thing that has
 * ever kept a layer boundary intact.
 *
 * They read the source tree as text rather than importing it, so a violation is
 * reported as a file path a reader can go and open.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }

    if (/\.tsx?$/.test(entry)) out.push(full);
  }

  return out;
}

const FILES = sourceFiles(SRC).map((file) => ({
  path: relative(ROOT, file),
  body: readFileSync(file, "utf8"),
}));

function importsModule(body: string, specifier: string): boolean {
  // Matches `from "@/db"` and `from "@/db/schema"`, but not `from "@/db-utils"`.
  return new RegExp(`from ["']${specifier}(/[^"']*)?["']`).test(body);
}

describe("layering", () => {
  it("finds source files to check", () => {
    // Guards the guard: a broken walker would make every rule below vacuously
    // pass, which is the worst possible failure for an architecture test.
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("calls db() only from the model layer", () => {
    // Better Auth's Drizzle adapter is constructed with the db instance itself,
    // so the auth bootstrap is a genuine exception rather than a shortcut.
    const ALLOWED = new Set(["src/lib/auth.ts"]);

    const offenders = FILES.filter(
      ({ path, body }) =>
        !path.startsWith("src/models/") &&
        !path.startsWith("src/db/") &&
        !ALLOWED.has(path) &&
        importsModule(body, "@/db")
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps the schema out of everything above the model layer", () => {
    // Importing the table definitions is how a query sneaks back in above
    // models/. Services should take row types from the model that owns them —
    // `CreditRow` in src/models/credit.ts is the pattern.
    const ALLOWED = new Set(["src/lib/auth.ts"]);

    const offenders = FILES.filter(
      ({ path, body }) =>
        !path.startsWith("src/models/") &&
        !path.startsWith("src/db/") &&
        !ALLOWED.has(path) &&
        importsModule(body, "@/db/schema")
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("never has a lower layer import an upper one", () => {
    // Data flows one way: app -> services -> models -> db. A model importing a
    // service is a cycle waiting to happen and makes the model untestable in
    // isolation.
    const upward = [
      { layer: "src/models/", forbidden: ["@/services", "@/app"] },
      { layer: "src/services/", forbidden: ["@/app"] },
      { layer: "src/config/", forbidden: ["@/services", "@/models", "@/app"] },
    ];

    const offenders: string[] = [];

    for (const { layer, forbidden } of upward) {
      for (const { path, body } of FILES) {
        if (!path.startsWith(layer)) continue;

        for (const specifier of forbidden) {
          if (importsModule(body, specifier)) {
            offenders.push(`${path} imports ${specifier}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps domain knowledge out of lib/", () => {
    // lib/ is framework-agnostic utility code. Nothing in it should know what a
    // credit or a reservation is, or it stops being reusable and starts being a
    // second services/ directory.
    const ALLOWED = new Set(["src/lib/auth.ts"]);

    const offenders = FILES.filter(
      ({ path, body }) =>
        path.startsWith("src/lib/") &&
        !ALLOWED.has(path) &&
        (importsModule(body, "@/services") || importsModule(body, "@/models"))
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps queries out of React components", () => {
    const offenders = FILES.filter(
      ({ path, body }) =>
        path.startsWith("src/components/") &&
        (importsModule(body, "@/db") || importsModule(body, "@/models"))
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});

describe("conventions", () => {
  it("has no src/features directory", () => {
    // The repo settled on horizontal layers. features/reservations was the lone
    // vertical slice and was flattened; this stops a second one from appearing
    // and re-splitting the codebase into two architectures.
    const dirs = readdirSync(SRC).filter((entry) =>
      statSync(join(SRC, entry)).isDirectory()
    );

    expect(dirs).not.toContain("features");
  });

  it("uses kebab-case filenames", () => {
    // Matches the rule in AGENTS.md. Route groups and dynamic segments in
    // app/ are Next.js syntax, so only the filename itself is checked.
    const offenders = FILES.filter(({ path }) => {
      const name = path.split("/").pop() ?? "";
      return !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.tsx?$/.test(name);
    }).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});
