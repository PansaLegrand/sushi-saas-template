# Testing

This is the reference for how tests work in this repo. It is meant to be read
before writing a test, and to be argued with — the rules below are deliberate,
so change them on purpose rather than by drift.

## The principle

**Test the thing that would actually break, at the lowest tier that can prove
it.** Every rule below follows from that. A mocked test that asserts a mock was
called proves nothing about production; a test that boots the whole app to check
a pure function wastes everyone's time.

---

## The five tiers

Each tier has a fixed location, a fixed budget, and — most importantly — a rule
about what it is **allowed to mock**. Mocking discipline is what keeps tiers from
collapsing into each other.

| Tier | Location | May mock | Must not | Budget |
| --- | --- | --- | --- | --- |
| **Unit** | `tests/unit/` | nothing | import routes or models | < 5 ms |
| **Route** | `tests/api/` | `@/services/*`, `@/models/*`, external SDKs | mock `@/lib/*` guards | < 50 ms |
| **Service** | `tests/services/` | `@/models/*`, external SDKs | mock the module under test | < 50 ms |
| **Component** | `tests/components/` | `fetch` | mock the component under test | < 100 ms |
| **Infrastructure** | `tests/db/` | nothing | fake an external service | opt-in |

### Unit — `tests/unit/`

Pure logic with no I/O: env parsing, origin checks, rate-limit windows, captcha
verification, cron auth. No `vi.mock` should appear in this directory. If a
function needs a mock to be tested, it is not a unit — move it down a tier or
extract the pure part.

`architecture.test.ts` also lives here. It reads the source tree as text and
fails the build when a layer boundary is crossed — a file outside `models/`
importing `@/db`, a model importing a service, `lib/` growing domain knowledge, a
`src/features/` directory reappearing. Documentation describing an architecture
decays; this does not. When it fails it names the offending file path.

### Route — `tests/api/`

Exercises an App Router handler by calling it with a real `Request`. Mocks the
data layer so the test is about the **handler contract**: status code, response
envelope, and which services were called with what.

The rule that matters: **do not mock `@/lib/*`.** `resp`, `rate-limit`, `origin`
and `cron` are the guards. A route test that stubs them is testing a route that
does not exist in production.

### Service — `tests/services/`

Orchestration logic — the code between a route and the database. Mocks
`@/models/*` and SDKs, never the module under test. This is where retry
behaviour, credit arithmetic, and job dispatch get their fast coverage.

### Component — `tests/components/`

Runs in jsdom with Testing Library, as its own Vitest project — the `mocked`
project only collects `.ts`, so a `.tsx` file here can never be pulled into a
Node environment with no `document`. Files are `*.test.tsx`; `setup.ts` installs
jest-dom matchers and the DOM APIs Radix needs that jsdom lacks
(`ResizeObserver`, pointer capture).

What belongs here is **behaviour a user could notice and a type checker could
not**: that a dialog traps focus and closes on Escape, that a label is actually
associated with its input, that a failed request renders catalogued copy instead
of the server's English. `stubGlobal("fetch", …)` is the only mock this tier
needs — mocking the component under test defeats the purpose.

What does not belong here: snapshot tests of markup, assertions that a prop was
passed through, or anything that would fail on a purely visual change. Those
break on every refactor and prove nothing.

### Infrastructure — `tests/db/`

Real calls against Postgres and Redis. This tier exists for invariants
**enforced by infrastructure, not by TypeScript**:

- `UNIQUE` indexes (`credits.trans_no`, `jobs.dedupe_key`, `users(email, signin_provider)`)
- `FOR UPDATE SKIP LOCKED` in `claimDueJobs` — concurrency has no meaning with one mocked connection
- Timestamp and expiry arithmetic on values that made a round trip through `timestamptz`
- Atomic Redis counters and TTLs that survive a new application client instance

Everywhere else in the suite, `@/models/*` is mocked. That means the entire SQL
layer is asserted only as a belief about what the schema does. This tier is
where that belief gets checked — and it earned its keep on the first run, by
catching a `claimDueJobs` crash that made the job queue unable to claim any work
at all. Every mocked test passed throughout, because they mock the function that
was broken.

It is **opt-in per service**: Postgres tests need `TEST_DATABASE_URL`; the Redis
test needs `TEST_REDIS_URL`. Without either, the default test command remains a
zero-dependency run. CI always sets both, and fails rather than silently
skipping either service.

---

## The rules

**1. Every route gets an auth-gate test before it gets a happy-path test.**

Unauthenticated request → assert the status code **and** assert the data
function was never called:

```ts
expect(res.status).toBe(401);
expect(mocks.getUserProfileByUuid).not.toHaveBeenCalled();
```

The negative assertion is the point. A 401 returned *after* loading the record
is a data leak that a status-code-only test happily passes. A route with only a
happy-path test is worse than an untested one, because it looks covered.

**2. Every mutation of money or credits gets a replay test.**

Call it twice with the same input; assert one effect. This is the invariant the
job queue exists to provide, and it is the difference between a retry and a
double charge. See `tests/db/credits.ledger.test.ts` — the signup grant is
invoked three times and must produce exactly one ledger row.

**3. Mock at the module boundary, and declare mocks with `vi.hoisted`.**

```ts
const mocks = vi.hoisted(() => ({
  getUserUuid: vi.fn<typeof import("@/services/user").getUserUuid>(),
}));

vi.mock("@/services/user", () => ({ getUserUuid: mocks.getUserUuid }));

// Import the module under test *after* the mocks.
import { POST as handler } from "@/app/api/account/profile/route";
```

Type the `vi.fn` with the real signature. A bare `vi.fn()` accepts anything, so
when the real function gains a required argument the mock keeps passing and the
test silently stops matching production. Typing it turns that into a type error.

**4. Assert behaviour, not implementation.**

`expect(insertOrder).toHaveBeenCalledWith(expect.objectContaining({ status: "created" }))`
is a contract. `expect(insertOrder).toHaveBeenCalledTimes(1)` alone is a
tripwire that fires on every harmless refactor.

**5. Reset shared state in `beforeEach`.**

`vi.clearAllMocks()` plus anything module-level — the rate limiter keeps counts
across tests, hence `resetRateLimitForTests()`.

**6. Build requests with `tests/helpers/request.ts`.**

Header casing and body encoding matter to `req.json()` and the origin guards.
One builder, not fifteen slightly different inline ones.

**7. The coverage floor only goes up.**

Thresholds live in `vitest.config.mts`, scoped to `src/services`, `src/models`,
`src/lib`, `src/app/api`, and `apps/admin/lib` — the trees where a bug costs
money. A repo-wide percentage is dominated by pages and components and tells you
nothing.

When a run comes in above the floor, raise the floor in the same PR. **Never
lower a threshold to make a red build green** — that is the ratchet doing its
job. If a PR genuinely cannot meet it, that is a conversation, not a config
edit.

**8. The database tier runs in one worker. Do not "optimize" that.**

All three `tests/db` files share one database and each truncates the same tables
between tests, so running them in parallel means one file's `beforeEach` wipes
rows another file is mid-assertion on. The symptom is nasty: tests that pass and
fail on alternate runs, with the failures moving around, which reads like a
flaky database rather than a config mistake.

`vitest.config.mts` puts that tier in its own project pinned to a single fork.
Note that `fileParallelism: false` is *not* the fix — it is root-only in Vitest 3
and is silently ignored inside a project. If you add a file to `tests/db`, it
inherits the right behaviour automatically.

**9. Comments explain why the test exists.**

Every test file opens with a note on what would break in production if this file
were deleted. If you cannot write that sentence, you may not need the test.

---

## Commands

```bash
pnpm test          # watch mode
pnpm test:run      # single pass; real-service tests skip when URLs are absent
pnpm test:cov      # with coverage; fails below the thresholds
pnpm test:db       # infrastructure tier (TEST_DATABASE_URL / TEST_REDIS_URL)
```

### Running the infrastructure tier locally

The simplest path is `pnpm setup`, which starts both services and writes both
test URLs. For a manual setup:

```bash
createdb sushi_test
```

```bash
export TEST_DATABASE_URL=postgresql://localhost:5432/sushi_test
export TEST_REDIS_URL=redis://localhost:6379
```

```bash
pnpm test:db:setup && pnpm test:db
```

Or with Docker, then point `TEST_DATABASE_URL` at
`postgresql://postgres:postgres@localhost:5433/sushi_test`:

```bash
docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sushi_test --name sushi-test-db postgres:16
```

**Safety:** the database tier truncates tables between tests, so
`TEST_DATABASE_URL` must name a database containing `"test"`. Both
`tests/db/setup.ts` and `scripts/setup-test-db.mjs` refuse to run otherwise.
This is what stops a connection string pasted from a hosting dashboard from
wiping something real. `TEST_DATABASE_URL` is deliberately separate from
`DATABASE_URL` — the tier never inherits whatever the app is pointed at.
The Redis test uses a UUID-prefixed key and deletes that exact key only; it
never calls `FLUSHDB`.

---

## Where it runs

- **pre-commit** (`.husky/pre-commit`): `pnpm lint && pnpm test:run` — ~10s.
  Fast enough that nobody reaches for `--no-verify`.
- **prebuild**: `pnpm test:run` runs before every build, local or otherwise.
- **CI** (`.github/workflows/ci.yml`): lint → migrate test DB → `pnpm test:cov`
  (all five tiers, thresholds enforced) → build both apps. Postgres 16 and
  Redis 7 service containers back the infrastructure tier.

---

## Environment

- Node 20+; tests use the platform `Request`/`Response`. No server is started.
- Mocked tiers make no network or database calls.
- The Stripe webhook test generates a real signature in-process against a dummy
  `STRIPE_WEBHOOK_SECRET` rather than stubbing `constructEvent` — the signature
  check is the thing worth testing.
- `server-only` is aliased to `tests/shims/server-only.ts` so App Router modules
  import cleanly under Node.

---

## What is not covered yet

Kept honest on purpose; this is the backlog, roughly in priority order.

- **Untested routes**: storage (4), reservations (4), affiliate (2),
  `billing/portal`, `feedback`, `pay/callback`, `tasks/[uuid]`, `tasks/latest`,
  and the admin orders/users read routes.
- **No component tests.** No jsdom or Testing Library is installed. Worth adding
  for the auth forms and pricing table when they stabilise.
- **No end-to-end tests.** The one layer mocked tests cannot reach is a real
  browser against a real server. A `scripts/smoke.ts` that signs in with
  env-supplied credentials and walks the critical paths would be the cheapest
  version. Credentials come from the environment, never from a file.

### Manual aids

Stripe end-to-end checks during development:

```bash
stripe listen --forward-to localhost:3000/api/pay/webhook/stripe
```

```bash
stripe trigger checkout_session_completed
```

Requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `NEXT_PUBLIC_WEB_URL`
in `.env.local`.
