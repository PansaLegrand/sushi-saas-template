# Repository Guidelines

## Project Structure & Module Organization

### The layers

Data flows in one direction. Each layer may call the one below it, never the one above.

```
src/app/**            routes and pages — HTTP in, HTTP out
  ↓
src/services/**       business logic, orchestration, invariants
  ↓
src/models/**         typed CRUD. The ONLY place db() may be called
  ↓
src/db/               schema, migrations, connection
```

Two rules make this real:

1. **`db()` is called only from `src/models/**`.** A service that reaches past the model layer means the next person has two places to look for a query. If the model helper you need does not exist, add it — see `listAllCreditsByOrg`, added because the paginated helper would have silently capped a balance calculation at 50 rows.
2. **Routes may read through a model directly, but must never write through one.** A route doing one trivial lookup does not need a service wrapper. Writes carry the invariants — idempotency keys, ledger rules, audit logging — and those belong in a service.

### Every directory in `src/`

| Directory | Holds | Rule |
| --- | --- | --- |
| `api/` | Browser-side calls to this app's own API, one module per domain | Client-only. Never imports `services/`, `models/`, `db/`, or `app/` |
| `config/site.ts` | Product runtime identity — brand, external docs URL, support contact | Defaults must be neutral; public website content does not belong in this repo |
| `app/` | App Router routes, `[locale]` pages, `api/` handlers | No business logic; call a service |
| `components/` | Shared React components, grouped by domain (`auth/`, `storage/`, `blocks/`, `ui/`) | Presentational; no `db()`, no model imports, no raw `fetch` |
| `config/` | Product configuration: the plan catalog, pricing, billing amounts, auth route map, reservation settings | Constants and env-derived flags only — no I/O, and never imports a service or model. `config/plans.ts` is further confined: only `services/entitlements.ts` may import it |
| `db/` | Drizzle schema, migrations, connection factory | Read `docs/database.md` before changing the schema |
| `i18n/` | Locale config and message loading (catalogs live in `messages/`) | Keep all five locales aligned |
| `integrations/` | External SDK client construction only (Stripe, Slack) | Clients, not logic — the logic goes in `services/` |
| `lib/` | Framework-agnostic utilities: env, logger, errors, rate limit, origin, hashing | No domain knowledge; nothing here should know what a credit is |
| `models/` | Typed CRUD per table | The only layer allowed to call `db()` |
| `providers/` | React context providers and third-party script wrappers | Client components |
| `services/` | Business logic. Group a domain into a folder once it exceeds one file (`email/`, `storage/`, `jobs/`, `stripe/`) | May call models and other services, never `db()` |
| `types/` | Shared TypeScript types not owned by a single module | Types only |

Also: root `docs/` contains co-versioned engineering runbooks and must change
when the implementation contract changes. Public guides, marketing pages, and
blog content live in the detached documentation-site repository, not under
`src/app` or a `content/` directory here. `public/` is static application assets.

### One architecture, enforced by tests

The repo is **horizontally layered**, everywhere, with no exceptions. There was
briefly a second convention — `src/features/reservations/` was a vertical slice
carrying its own models, service, config, and components — and it has been
flattened into the layers above. **Do not reintroduce a `src/features/`
directory.** A codebase with two architectures makes every new file a coin flip.

Adding a domain means spreading it across the layers, the way reservations now
is: `models/reservation.ts`, `services/reservations/`, `config/reservations.ts`,
`components/reservations/`.

`tests/unit/architecture.test.ts` enforces this. It fails the build when a file
outside `models/` imports `@/db` or `@/db/schema`, when a lower layer imports an
upper one, when `lib/` grows domain knowledge, when a component reaches for a
query, when a filename is not kebab-case, or when `src/features/` reappears. The
one allowlisted exception is `src/lib/auth.ts`, which must hand the db instance
to Better Auth's Drizzle adapter.

### Authorization is a capability, never a tier name

Plan gating goes through one door. Ask `can(...)`, `requireEntitlement(...)`, or
`enforceLimit(...)` from `src/services/entitlements.ts`; never import
`@/config/plans` and never write `tier === "max"`. Both are enforced by the
architecture test, and the reason is that the alternative — tier comparisons
spread across routes and components — makes adding a tier a grep you will not
finish. See `docs/plans.md`.

The admin app keeps its own data layer at `apps/admin/lib/data.ts` by design —
see `apps/admin/README.md`. Its browser-side calls live in `apps/admin/lib/api.ts`
for the same reason: nothing in `src/` should be able to reach an admin endpoint.

### The application and public website have independent release trains

This repository builds only the SaaS application and its admin console. The
public marketing/documentation website is a detached Git repository—never a
branch, build mode, or submodule of this one.

Three rules keep the boundary honest:

1. `src/config/site.ts` may hold only the product runtime's neutral identity,
   optional external docs URL, and optional support address.
2. Root `docs/` is for engineering contracts that must be reviewed with code.
   Tutorials, SEO pages, and articles go to the documentation-site repository.
3. A change that affects public guidance is implemented in both repositories
   and cross-linked in the PR; it does not reintroduce Fumadocs or MDX here.

`tests/unit/architecture.test.ts` fails the build if a personal email address or
project URL leaks outside the identity configuration.

### The frontend rules

Data reaches the browser two ways, and mixing them is the mistake to avoid.

```
Server Component  ──▶ src/services/**        (direct call, no HTTP)
Client Component  ──▶ src/api/**  ──▶  src/lib/api/client.ts  ──▶  /api/**
```

1. **Server Components call services directly.** Never fetch your own API from a
   Server Component — it turns a zero-latency in-process call into an HTTP round
   trip against your own server, and it is the easiest way to make a fast page
   slow without noticing.
2. **Client Components never call `fetch` directly.** Add an endpoint wrapper to
   `src/api/` instead. A raw `fetch` has to hand-roll envelope unwrapping and
   error handling, and the hand-rolled version is how untranslated server text
   used to end up on screen. The two allowlisted exceptions are
   `src/lib/api/client.ts`, which owns the primitive, and the uploader, which
   PUTs to object storage over XHR for progress events.
3. **Never render `error.message`.** Resolve failures through the catalog —
   `resolveErrorMessage` for API errors, `resolveAuthError` for Better Auth. Both
   map an unrecognized failure to a generic message rather than passing it
   through, which is the same no-leak rule the server follows.
4. **Every route segment has an error boundary.** `src/app/global-error.tsx`,
   `src/app/[locale]/error.tsx`, and `src/app/[locale]/not-found.tsx` must exist.
   Without them a throw during render reaches Next's default screen, which in
   production is an untranslated "Application error" with no way back.
5. **Reach for `src/components/ui/` before hand-styling.** `Dialog` (Radix — do
   not hand-roll a modal), `Field`, `Input`, `Textarea`, `Select`, `Alert`,
   `Card`, `Table`, `Skeleton`, `EmptyState`. Ordinary visible controls use
   these primitives; raw elements are for hidden, checkbox, file, and
   provider-owned cases. Add a primitive on the third duplicate, not the first.
6. **Presets own visual language; primitives own ergonomics.** Components use
   semantic tokens and never branch on `stylePreset` or `data-style`. Normal
   controls are comfortable by default; compact density is an explicit local
   choice, not an admin-wide default.
7. **Pages compose patterns instead of recreating chrome.** Admin pages reach
   for `AdminPageHeader`, `AdminToolbar`, `AdminPanel`, `AdminTable`,
   `AdminTabs`, and `AdminHelp`. Pages own data and broad layout; patterns own
   repeated spacing, table treatment, and hierarchy. See `docs/frontend.md`.

The mechanically detectable parts are enforced by
`tests/unit/architecture.test.ts`; interaction behavior belongs in component
tests and visual hierarchy still requires browser review.

### Tasks & Credits (Usage‑based features)
- Schema: `tasks` table in `src/db/schema.ts` holds generic task records (type, status, credits_used, user_input, output_url/json, error_message). Indexes by `user_uuid` and `status`.
- Models: `src/models/task.ts` for insert/find/update/list helpers.
- Services:
  - `src/services/ai/video.ts` (provider adapter stub — swap with Replicate/OpenAI or your engine).
  - `src/services/tasks.ts#createTextToVideoTask` orchestrates: deduct credits → call provider → persist task.
  - Credits transaction type: `task_text_to_video` in `src/services/credit.ts`.
  - Each task stores `credits_trans_no` to trace the exact ledger entry used.
- API Routes:
  - `POST /api/tasks/text-to-video` — create task, spend credits, return task + `outputUrl`.
  - `GET /api/tasks/[uuid]` — fetch task (owner‑scoped).
- UI (dev/demo): minimal client page at `src/app/[locale]/tasks/text-to-video/page.tsx`.
 - Pricing constants: `src/config/tasks.ts` defines per‑second cost and aspect multipliers.
 - Env:
  - `TEXT2VIDEO_MOCK_URL` — dev fallback video URL.
- Migrations: after changing `src/db/schema.ts`, always run:
  - `pnpm db:generate` (writes `src/db/migrations/NNNN_*.sql` — commit it with `meta/_journal.json`)
  - `pnpm db:migrate` (applies locally)
  - Migrations must be expand/contract safe: the currently deployed code has to keep working against the new schema, because code and schema ship separately. See `DEPLOYMENT.md`.

Notes:
- Keep provider specifics in `services/ai/*`; do not hardcode in routes.
- Consider async task processing and refunds-on-failure for production.

## Build, Test, and Development Commands
- `pnpm install && pnpm setup`: First-clone bootstrap — writes `.env` with generated secrets, starts local Postgres via `docker-compose.yml`, applies migrations to the dev and test databases. Idempotent; never overwrites an existing `.env`.
- `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio`: Drizzle workflow against the local database.
- `pnpm db:check:prod` / `pnpm db:migrate:prod`: Deployed-database migration runner (advisory-locked, non-interactive). Migrations are **never** automatic on deploy — see `DEPLOYMENT.md`.
- `pnpm dev` / `pnpm dev:webpack`: Start the application dev server (Turbopack or Webpack).
- `pnpm build` then `pnpm start`: Production build and runtime smoke test; both must succeed before opening a PR.
- `pnpm lint`: Execute `next lint`; warnings are treated as blockers.
- `pnpm test:run` / `pnpm test:cov` / `pnpm test:db`: Vitest tiers; see `tests/README.md`. `test:db` additionally needs `TEST_DATABASE_URL` and a one-time `pnpm test:db:setup`.
- `pnpm drizzle-kit <generate|migrate> --config src/db/config.ts`: Keep database migrations synchronized with `src/db/schema.ts`.
 - The `files` table powers uploads; regenerate and migrate when touching storage schema.
  - The `tasks` table powers usage tracking; regenerate and migrate when touching task schema.

## Error Handling
**Read `docs/errors.md` before writing any error path.** Non-negotiables: server code throws `AppError` with a code from `src/lib/errors/catalog.ts`, never `new Error("...")`; every route `catch` ends in `respError(error, ...)`, never returning `error.message`; UI branches on `error_code`, never on message text; error copy lives in `src/lib/errors/i18n/locales/` (all five locales) and never in `messages/`. Adding a code without its five translations fails the test suite.

## Coding Style & Naming Conventions
- TypeScript-first; prefer named exports and React Server Components unless client-only APIs force `"use client"`.
- Compose UI with functional components, Tailwind utilities, and co-locate reusable pieces under `src/components`. Check `src/components/ui/` for an existing primitive first — see "The frontend rules" above.
- Files stay kebab-case (`auth-screen.tsx`); colocate feature helpers and avoid deep relative imports—use `@/` alias instead.
- Run `pnpm lint` before pushing; enable ESLint and Tailwind IntelliSense in your editor for consistent output.
 - Storage adapters: do not hardcode provider specifics in routes; extend `StorageAdapter` and select via `getStorageAdapter()`.

## Testing Guidelines
**Read `tests/README.md` before writing a test — it is the authoritative guide.** The summary:

- Vitest, five tiers, each defined by what it may mock: `tests/unit` (mocks nothing), `tests/api` (mocks services/models, never `@/lib/*` guards), `tests/services` (mocks models), `tests/components` (browser-visible behavior), and `tests/db` (mocks nothing, needs real infrastructure).
- Tests live under `tests/`, mirroring the source tree — not colocated beside the feature.
- `pnpm test:run` for a single pass (~1s), `pnpm test:cov` to enforce coverage thresholds, `pnpm test:db` for the database tier.
- The database tier is opt-in via `TEST_DATABASE_URL` and skips without it. It truncates tables, so the database name must contain `"test"`; both the harness and `scripts/setup-test-db.mjs` refuse otherwise. CI runs it against a Postgres 16 service container.
- Two non-negotiables: every route gets an auth-gate test asserting the data function was **not** called before the 401/403, and every credit or money mutation gets a replay test proving one effect from two identical calls.
- Coverage thresholds in `vitest.config.mts` are a ratchet scoped to `src/services`, `src/models`, `src/lib`, `src/app/api`, and `apps/admin/lib`. Raise them when a run beats them; never lower one to turn a build green.
- Gates: pre-commit runs `pnpm lint && pnpm test:run`; `prebuild` runs the tests again; CI runs lint → migrate test DB → `pnpm test:cov` → build.
- For auth or i18n work, verify at least one happy-path call (e.g., `/api/health` or a localized landing page) and document the manual check in the PR.
 - For storage, verify the minimal flow end‑to‑end:
   1) `POST /api/storage/uploads` returns a presigned URL
   2) PUT bytes to the returned URL
   3) `POST /api/storage/uploads/complete` marks the row `active`
   4) `GET /api/storage/files/[uuid]?download=1` returns a signed download URL
   5) `DELETE /api/storage/files/[uuid]` soft‑deletes and removes the object

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`feat:`, `fix:`, `chore:`) as reflected in recent history.
- Keep commits focused; call out migrations, new env vars, or breaking config changes in the body.
- PRs must include a summary, validation notes (`pnpm lint`, `pnpm build`, migrations), linked issues, and UI screenshots when applicable.
- Request owner review for changes touching `src/app/api` or `src/db` because they affect deployments and authentication.
 - Changes to storage adapters (`src/services/storage/*`) or `files` schema must call out required env vars, CORS rules, and any backward‑compat constraints (e.g., key format).

## Security & Configuration Tips
- Store secrets in `.env` using `.env.example` as the template; never commit real credentials.
- Ensure `BETTER_AUTH_SECRET`, `DATABASE_URL`, and `NEXT_PUBLIC_AUTH_BASE_URL` are set before running dev servers or migrations.
 - Storage env (document in PRs when touched):
   - `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ENDPOINT`
   - `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `S3_FORCE_PATH_STYLE`, `STORAGE_MAX_UPLOAD_MB`
   - Optional client hint: `NEXT_PUBLIC_UPLOAD_MAX_MB`
 - Keep objects private by default; only expose short‑lived presigned URLs. Never leak raw credentials to client code.
 - Tasks config:
   - Pricing: `src/config/tasks.ts` constants control credit consumption.
   - Env: `TEXT2VIDEO_MOCK_URL` (document in PRs when touched)
