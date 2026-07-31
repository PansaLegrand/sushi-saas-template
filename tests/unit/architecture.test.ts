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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
        importsModule(body, "@/db"),
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
        importsModule(body, "@/db/schema"),
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
        (importsModule(body, "@/services") || importsModule(body, "@/models")),
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("confines the plan catalog to the entitlement service", () => {
    // The single door. Authorization is expressed as `can(...)` and
    // `enforceLimit(...)`, never as a tier comparison, and this rule is what
    // keeps it that way — the version of this system where forty call sites
    // read the catalog directly works fine until you add a tier between two
    // existing ones, and then it is a grep you will not finish.
    //
    // The service re-exports what other layers legitimately need
    // (`tierForPriceId` for the Stripe webhook, `describePlans` for billing UI).
    const ALLOWED = new Set([
      "src/config/plans.ts",
      "src/services/entitlements.ts",
    ]);

    const offenders = FILES.filter(
      ({ path, body }) =>
        !ALLOWED.has(path) && importsModule(body, "@/config/plans"),
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("confines the billing catalog to its adapters", () => {
    // Checkout and renewals go through the billing-catalog service; UI copy is
    // derived in config/pricing, and config/plans derives Stripe entitlement
    // mappings from the same source. No route should read commercial terms
    // directly.
    const ALLOWED = new Set([
      "src/config/billing.ts",
      "src/config/plans.ts",
      "src/config/pricing.ts",
      "src/services/billing-catalog.ts",
    ]);

    const offenders = FILES.filter(
      ({ path, body }) =>
        !ALLOWED.has(path) && importsModule(body, "@/config/billing"),
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("never branches on a tier name", () => {
    // The other half of the rule above: `PlanSnapshot["tier"]` is a string
    // union, so a component can compare against a literal without importing
    // anything. That is the leak this catches.
    //
    // Add a tier to the catalog and add it here too.
    const TIER_LITERALS = ["free", "plus", "max"];
    const pattern = new RegExp(
      `\\b(?:tier|plan)\\w*\\s*[!=]==\\s*["'](?:${TIER_LITERALS.join("|")})["']`,
    );

    const ALLOWED = new Set([
      "src/config/plans.ts",
      "src/services/entitlements.ts",
    ]);

    const offenders = FILES.filter(
      ({ path, body }) =>
        !ALLOWED.has(path) && pattern.test(stripComments(body)),
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps queries out of React components", () => {
    const offenders = FILES.filter(
      ({ path, body }) =>
        path.startsWith("src/components/") &&
        (importsModule(body, "@/db") || importsModule(body, "@/models")),
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
        (path.startsWith("src/components/") ||
          path.startsWith("src/app/[locale]/")) &&
        !ALLOWED.has(path) &&
        /\bfetch\s*\(/.test(stripComments(body)),
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
      expect(
        FILES.some(({ path }) => path === file),
        `missing ${file}`,
      ).toBe(true);
    }

    // The separately deployed admin app needs its own recovery surface. The
    // nested files keep the authenticated shell mounted for page-level
    // failures, while the root files cover auth, unmatched URLs, and a broken
    // root layout.
    for (const file of [
      "apps/admin/app/global-error.tsx",
      "apps/admin/app/error.tsx",
      "apps/admin/app/not-found.tsx",
      "apps/admin/app/loading.tsx",
      "apps/admin/app/(admin)/error.tsx",
      "apps/admin/app/(admin)/not-found.tsx",
      "apps/admin/app/(admin)/loading.tsx",
    ]) {
      expect(existsSync(join(ROOT, file)), `missing ${file}`).toBe(true);
    }
  });

  it("keeps API route failures on the catalogued error boundary", () => {
    // Route code should return respCode(...) for known failures and respError(...)
    // for exceptions. respErr(...) is the old escape hatch that sends ad-hoc
    // English over the wire and leaves clients branching on message text.
    const offenders = API_ROUTE_FILES.filter(({ body }) =>
      /\brespErr\s*\(/.test(stripComments(body)),
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("parses JSON API request bodies through zod schemas", () => {
    // Direct req.json() casts were the source of drift: each route decided for
    // itself whether malformed JSON was empty input, invalid params, or a server
    // failure. JSON routes should use parseJsonBody(...). Non-JSON routes can
    // still read text/formData directly, e.g. Stripe webhooks and uploads.
    const offenders = API_ROUTE_FILES.filter(({ body }) =>
      /\b(?:req|request)\.json\s*\(/.test(stripComments(body)),
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});

describe("tenancy", () => {
  /**
   * Tables owned by an organization rather than by a user.
   *
   * `affiliates` and `feedbacks` are deliberately absent: a referral and a
   * piece of feedback belong to the person, not to the tenant they happen to
   * be working in.
   */
  const TENANT_TABLES = [
    "credits",
    "files",
    "orders",
    "reservations",
    "subscriptions",
    "tasks",
  ] as const;

  const MODEL_FILES = FILES.filter(({ path }) =>
    path.startsWith("src/models/"),
  );

  /** `.from(files)`, `.update(tasks)`, `.delete(credits)` — a query root. */
  function queryRoots(body: string, table: string): boolean {
    return new RegExp(`\\.(?:from|update|delete)\\(\\s*${table}\\s*[,)]`).test(
      stripComments(body),
    );
  }

  it("finds the tenant models to check", () => {
    // Guards the guard. A regex that stops matching would make every rule
    // below vacuously pass — the worst outcome for a rule about data leaks.
    const touched = MODEL_FILES.filter(({ body }) =>
      TENANT_TABLES.some((table) => queryRoots(body, table)),
    );

    expect(touched.length).toBeGreaterThanOrEqual(TENANT_TABLES.length);
  });

  it("scopes every tenant-table query to an organization", () => {
    /**
     * Models whose queries are legitimately global, each for a stated reason.
     *
     * This list is the whole risk surface of multi-tenancy in one place. A new
     * entry needs a reason that survives the question "what happens when two
     * customers both have a row matching this key".
     */
    const ALLOWED = new Map([
      [
        "src/models/stripe-webhook-event.ts",
        "Webhook idempotency is keyed on Stripe's event id, which is global by construction.",
      ],
      [
        "src/models/organization.ts",
        "Defines the scope predicate; it cannot be written in terms of itself.",
      ],
      [
        "src/models/account-lifecycle.ts",
        "A privacy request is deliberately account-wide: it locks one authenticated user, enumerates that user's memberships, and applies the export/erasure policy across those explicit organizations.",
      ],
    ]);

    const offenders = MODEL_FILES.filter(({ path, body }) => {
      if (ALLOWED.has(path)) return false;
      if (!TENANT_TABLES.some((table) => queryRoots(body, table))) return false;

      return !/\bscopedToOrg\b/.test(body);
    }).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("writes an organization on every tenant-table insert", () => {
    // A row inserted without `org_uuid` is invisible to every scoped read that
    // follows — the data is not lost, it is unreachable, which is worse
    // because nothing errors.
    const offenders = MODEL_FILES.filter(({ body }) => {
      const source = stripComments(body);
      const inserts = TENANT_TABLES.some((table) =>
        new RegExp(`\\.insert\\(\\s*${table}\\s*[,)]`).test(source),
      );

      return inserts && !/\borg_uuid\b/.test(source);
    }).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps the organization id out of request payloads", () => {
    // The tenant a request acts in comes from the session and the URL, resolved
    // by getOrgContext(). A body-supplied org_uuid is an authorization bypass
    // with a friendly name: anyone could post another tenant's id.
    const offenders = API_ROUTE_FILES.filter(({ body }) =>
      /\borg_?[uU]uid\s*:\s*z\./.test(stripComments(body)),
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
        /[\w.+-]+@(?!example\.(?:com|org)\b)[\w-]+\.[a-z]{2,}/i.test(
          stripComments(body),
        ),
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps the project's own URLs out of source", () => {
    // A clone should never link back to this project's repo, Discord, or socials.
    const offenders = FILES.filter(
      ({ path, body }) =>
        path !== SITE_ISLAND &&
        /(github\.com\/[\w-]+\/[\w.-]+|discord\.gg\/|x\.com\/|twitter\.com\/)/i.test(
          stripComments(body),
        ),
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});

describe("conventions", () => {
  it("keeps application UI colors on semantic theme tokens", () => {
    // Named Tailwind palettes make a component look correct in one preset and
    // silently ignore the other four. Brand artwork and root-error fallback
    // CSS use SVG/style values rather than utility classes, so they remain
    // deliberate exceptions without weakening this guard.
    const uiFiles = [
      ...FILES.filter(
        ({ path }) =>
          path.startsWith("src/components/") ||
          (path.startsWith("src/app/") && !path.startsWith("src/app/api/")),
      ),
      ...[
        ...sourceFiles(join(ROOT, "apps/admin/app")),
        ...sourceFiles(join(ROOT, "apps/admin/components")),
      ].map((file) => ({
        path: relative(ROOT, file),
        body: readFileSync(file, "utf8"),
      })),
    ];
    const namedPaletteUtility =
      /\b(?:bg|text|border|ring|outline|fill|stroke)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/;
    const offenders = uiFiles
      .filter((file) => namedPaletteUtility.test(stripComments(file.body)))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it("has no src/features directory", () => {
    // The repo settled on horizontal layers. features/reservations was the lone
    // vertical slice and was flattened; this stops a second one from appearing
    // and re-splitting the codebase into two architectures.
    const dirs = readdirSync(SRC).filter((entry) =>
      statSync(join(SRC, entry)).isDirectory(),
    );

    expect(dirs).not.toContain("features");
  });

  it("gates every third-party tracking script on consent", () => {
    // Consent is only real if the tag never renders without it. Setting a flag
    // inside gtag after the script has loaded is not consent: the script has
    // already set cookies and already contacted the vendor.
    //
    // Matching on the vendor host rather than a list of filenames is the point
    // — a new provider file added next month is caught the same way.
    const TRACKER_HOSTS =
      /googletagmanager\.com|google-analytics\.com|adsbygoogle|pagead2\.googlesyndication\.com/;

    const offenders = FILES.filter(({ path, body }) => {
      if (path.startsWith("src/config/")) return false; // names them, never loads them
      const source = stripComments(body);
      if (!TRACKER_HOSTS.test(source)) return false;
      return !/useConsent\s*\(/.test(source);
    }).map(({ path }) => path);

    expect(offenders).toEqual([]);

    // The two the kit ships with, asserted by name so deleting the gate from an
    // existing provider fails even if the vendor URL moves into a dependency.
    for (const path of [
      "src/providers/google-analytics.tsx",
      "src/providers/adsense.tsx",
    ]) {
      const file = FILES.find((f) => f.path === path);
      expect(file, `missing ${path}`).toBeDefined();
      expect(
        /useConsent\s*\(/.test(stripComments(file!.body)),
        `${path} must gate on useConsent()`,
      ).toBe(true);
    }
  });

  it("logs server-side failures through the logger, not console", () => {
    // `console.error(e)` skips everything src/lib/logger does for us: the
    // request id that ties a failure to its request, the level threshold, and
    // — the reason this is a rule and not a preference — the redaction of
    // tokens, cookies, and connection strings. A raw Stripe or Postgres error
    // printed straight to stdout carries whatever the library put in it.
    //
    // Client components are exempt: the server logger is `server-only`, and a
    // browser error belongs in the browser console.
    const SERVER_FILES = [
      ...sourceFiles(SRC),
      ...sourceFiles(join(ROOT, "apps/admin/app")),
      ...sourceFiles(join(ROOT, "apps/admin/lib")),
    ].map((file) => ({
      path: relative(ROOT, file),
      body: readFileSync(file, "utf8"),
    }));

    // The logger itself is the one place that writes to the console.
    const ALLOWED = (path: string) => path.startsWith("src/lib/logger/");

    const offenders = SERVER_FILES.filter(({ path, body }) => {
      if (ALLOWED(path)) return false;
      if (/^\s*["']use client["']/.test(body)) return false;
      return /\bconsole\.(log|info|warn|error|debug)\s*\(/.test(
        stripComments(body),
      );
    }).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("constructs the Stripe client in exactly one place", () => {
    // A per-request `new Stripe(...)` builds its own HTTP agent, so it pays a
    // TLS handshake the SDK's keep-alive would have reused — and, the reason
    // this is a rule, it silently opts out of the `appInfo` and
    // `maxNetworkRetries` set on the shared client. Four handlers had drifted
    // into their own client before this existed.
    //
    // Only construction is banned. `Stripe.webhooks.constructEvent` is static
    // and needs no key, and importing the package for its types is fine.
    const ALLOWED = new Set(["src/integrations/stripe.ts"]);

    const offenders = FILES.filter(
      ({ path, body }) =>
        !ALLOWED.has(path) && /\bnew\s+Stripe\s*\(/.test(stripComments(body)),
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("serves every page through the [locale] segment", () => {
    // `localePrefix` is "as-needed": the default locale has no prefix, so `/`
    // and `/pricing` are English while `/es/pricing` is Spanish. That is done by
    // middleware rewriting `/pricing` to `/en/pricing` internally — which works
    // if no physical route shadows it.
    //
    // A `src/app/page.tsx` did exactly that, and the failure was not a wrong
    // page: it broke `next build`. Next tried to prerender `/` outside the
    // `[locale]` segment, where next-intl has no locale context, and threw an
    // error with an empty message. Lint and every test still passed, so only the
    // build caught it — which is why this rule exists at the tier that runs
    // first.
    //
    // Layouts, error boundaries, and `not-found.tsx` at the root are fine and
    // required. It is specifically a *page* that must not sit there.
    expect(existsSync(join(SRC, "app/page.tsx"))).toBe(false);
    expect(existsSync(join(SRC, "app/page.jsx"))).toBe(false);
  });

  it("generates record ids without a coordinated worker id", () => {
    // `simple-flakeid` produced `timestamp | workerId | sequence`, which is
    // collision-free only if every process holds a distinct worker id. Nothing on
    // Vercel assigns one, `SNOWFLAKE_WORKER_ID` defaulted to `1`, and so two
    // concurrent lambdas in the same millisecond minted the same id — surfacing as
    // a failed insert on `orders.order_no` or `credits.trans_no`.
    //
    // The rule bans the library rather than the pattern, because the pattern is
    // fine anywhere a worker id is actually assigned, and this deployment target
    // does not assign one. Use `newId()` from `src/lib/ids.ts`.
    const offenders = FILES.filter(({ body }) =>
      /from\s+["']simple-flakeid["']|@\/lib\/hash/.test(stripComments(body)),
    ).map(({ path }) => path);

    expect(offenders).toEqual([]);
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
