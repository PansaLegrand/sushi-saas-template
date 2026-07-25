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
const ADMIN_API = join(ROOT, "apps/admin/app/api");

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

const API_ROUTE_FILES = [
  ...sourceFiles(join(SRC, "app/api")),
  ...sourceFiles(ADMIN_API),
].map((file) => ({
  path: relative(ROOT, file),
  body: readFileSync(file, "utf8"),
}));

/**
 * Drop comments before pattern-matching source.
 *
 * Rules that look for a construct rather than an import have to, or a comment
 * explaining why the construct is banned trips the rule that bans it — which is
 * exactly what happened to `src/app/[locale]/error.tsx`.
 */
function stripComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

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

  it("keeps the browser API layer free of server code", () => {
    // src/api/ runs in the browser. Importing a service pulls the whole server
    // dependency chain — db driver, secrets, `server-only` — into the client
    // bundle, and in the best case the build fails loudly instead of quietly
    // shipping a connection string.
    const offenders: string[] = [];

    for (const { path, body } of FILES) {
      if (!path.startsWith("src/api/")) continue;

      for (const specifier of ["@/services", "@/models", "@/db", "@/app"]) {
        if (importsModule(body, specifier)) {
          offenders.push(`${path} imports ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("routes every browser API call through the client", () => {
    // A raw `fetch` in a component is how the `payload.message` pattern comes
    // back: it has to hand-roll envelope unwrapping and error handling, and the
    // hand-rolled version is what leaked untranslated server text to users.
    // Endpoint wrappers belong in src/api/, which calls src/lib/api/client.ts.
    const ALLOWED = new Set([
      // The one legitimate caller: it owns the fetch primitive.
      "src/lib/api/client.ts",
      // Uploads PUT directly to object storage over XHR for progress events,
      // and that response has no envelope to unwrap.
      "src/components/storage/uploader.tsx",
    ]);

    const offenders = FILES.filter(
      ({ path, body }) =>
        (path.startsWith("src/components/") || path.startsWith("src/app/[locale]/")) &&
        !ALLOWED.has(path) &&
        /\bfetch\s*\(/.test(stripComments(body))
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("never renders a raw error message", () => {
    // The no-leak guarantee, enforced. UI code resolves failures through the
    // catalog (`resolveErrorMessage` / `resolveAuthError`); reading `.message`
    // off a caught error puts backend or library English on screen, in whatever
    // locale the user is not using.
    const offenders: string[] = [];

    for (const { path, body } of FILES) {
      const isUi =
        path.startsWith("src/components/") ||
        (path.startsWith("src/app/") && !path.startsWith("src/app/api/"));
      if (!isUi) continue;

      // `error_message` is a task table column, not an exception, and \b keeps
      // it from matching.
      if (/\b(?:err|error|e)\??\.message\b/.test(stripComments(body))) {
        offenders.push(path);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("gives every route segment an error boundary", () => {
    // Without these, a throw during render reaches Next's default screen, which
    // in production is an untranslated "Application error" with no way back.
    for (const file of [
      "src/app/global-error.tsx",
      // Both not-found files are required and cover different cases: the root
      // one catches URLs that match no route, the nested one catches an
      // explicit `notFound()` from a localized page.
      "src/app/not-found.tsx",
      "src/app/[locale]/error.tsx",
      "src/app/[locale]/not-found.tsx",
    ]) {
      expect(FILES.some(({ path }) => path === file), `missing ${file}`).toBe(true);
    }
  });

  it("keeps API route failures on the catalogued error boundary", () => {
    // Route code should return respCode(...) for known failures and respError(...)
    // for exceptions. respErr(...) is the old escape hatch that sends ad-hoc
    // English over the wire and leaves clients branching on message text.
    const offenders = API_ROUTE_FILES.filter(({ body }) =>
      /\brespErr\s*\(/.test(stripComments(body))
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("parses JSON API request bodies through zod schemas", () => {
    // Direct req.json() casts were the source of drift: each route decided for
    // itself whether malformed JSON was empty input, invalid params, or a server
    // failure. JSON routes should use parseJsonBody(...). Non-JSON routes can
    // still read text/formData directly, e.g. Stripe webhooks and uploads.
    const offenders = API_ROUTE_FILES.filter(({ body }) =>
      /\b(?:req|request)\.json\s*\(/.test(stripComments(body))
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});

describe("site content", () => {
  // The kit and the project's own website are one repo but must not be one
  // thing. Site identity belongs in src/config/site.ts; anything else that
  // hardcodes it ships to everyone who clones the template — which is how the
  // landing page came to contain a personal email address and a GitHub star
  // count that was already out of date.
  const SITE_ISLAND = "src/config/site.ts";

  it("keeps contact addresses out of source", () => {
    const offenders = FILES.filter(
      ({ path, body }) =>
        path !== SITE_ISLAND &&
        /[\w.+-]+@(?!example\.(?:com|org)\b)[\w-]+\.[a-z]{2,}/i.test(stripComments(body))
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps the project's own URLs out of source", () => {
    // A clone should never link back to this project's repo, Discord, or socials.
    const offenders = FILES.filter(
      ({ path, body }) =>
        path !== SITE_ISLAND &&
        /(github\.com\/[\w-]+\/[\w.-]+|discord\.gg\/|x\.com\/|twitter\.com\/)/i.test(
          stripComments(body)
        )
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
