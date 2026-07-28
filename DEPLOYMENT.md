# Environments & Deployment

How to set up a local machine, how to stand up production, and what happens to
the database in between.

The short answer on migrations: **they are not automatic, on purpose.** See
[Migrations](#migrations).

---

## Local development

```bash
pnpm install && pnpm setup
```

`pnpm setup` ([scripts/setup-dev.mjs](scripts/setup-dev.mjs)) is idempotent and does three things:

1. Writes `.env` from `.env.example`, generating a real `BETTER_AUTH_SECRET` and
   `CRON_SECRET`, pointing `DATABASE_URL` and `TEST_DATABASE_URL` at the local
   container, and filling in Cloudflare's always-passes Turnstile test keys.
   **An existing `.env` is never overwritten.**
2. Starts Postgres 16 via [docker-compose.yml](docker-compose.yml) and waits for it to accept
   connections.
3. Applies migrations to both `sushi_dev` and `sushi_test`.

Then:

```bash
pnpm dev
```

Two databases on one server, deliberately: the `tests/db` tier truncates tables
on every test, so it gets `sushi_test` and never touches your dev data.

| Command | Purpose |
| --- | --- |
| `pnpm db:up` / `pnpm db:down` | Start / stop the container (data survives `down`) |
| `pnpm db:generate` | Generate migration SQL after editing `src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations locally |
| `pnpm db:studio` | Drizzle Studio, a browser UI over the data |

To wipe local data entirely: `docker compose down -v`, then `pnpm setup`.

**Already running Postgres on 5432?** Very common, and `pnpm setup` detects it
and stops rather than colliding. Create the two databases on the server you
already have, point both URLs in `.env` at it, then
`pnpm db:migrate && pnpm test:db:setup`. Full walkthrough in
[docs/database.md](docs/database.md#setting-up-from-a-fresh-clone).

No Docker at all? Same thing — install Postgres however you like, create
`sushi_dev` and `sushi_test`, and follow the steps above.

### Making yourself an admin

Roles live in `users.role`. Promote the first admin after signing up:

```bash
pnpm admin:promote you@example.com
```

The command defaults to `admin_rw`. Use `pnpm admin:promote you@example.com
admin_ro` for read-only admin access.

---

## Environment variables

`.env.example` is the full list with inline notes. What matters structurally:

**`NEXT_PUBLIC_*` values are baked into the JavaScript bundle at build time.**
Changing one in your hosting dashboard does nothing until you redeploy. Everything
else is read at runtime and takes effect on the next request.

**Required in production or the app refuses to start** — a deliberate design
choice, so a deploy cannot silently end up unprotected:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | Everything |
| `BETTER_AUTH_SECRET` | Session signing. `openssl rand -base64 32` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` | Bot protection on auth endpoints. Opt out only with `NEXT_PUBLIC_CAPTCHA_ENABLED=false` |
| `CRON_SECRET` | Guards `/api/cron/jobs`. `openssl rand -hex 32` |
| `STRIPE_PRICE_{PLUS,MAX}_{MONTHLY,YEARLY}` | Stable recurring Prices used by checkout, entitlement sync, and renewal grants |

**Required for the features that use them**: `RESEND_API_KEY` + `EMAIL_FROM`
(password reset, welcome, payment, reservation mail), `STRIPE_PRIVATE_KEY` +
`STRIPE_WEBHOOK_SECRET`, and the `STORAGE_*` block.

**Recommended for production scale**: `RATE_LIMIT_REDIS_REST_URL` +
`RATE_LIMIT_REDIS_REST_TOKEN`. Without them, rate limiting falls back to an
in-memory store, which is fine locally but is per-instance on serverless.

**Must not be set in production**: the `ENABLE_DEMO_FEATURES`,
`ENABLE_CREDITS_PLAYGROUND`, `ENABLE_TEXT2VIDEO_MOCK`, and
`ENABLE_ACCOUNT_CREDIT_GRANT` flags. They default off and are ignored in
production, but leaving them set is a confusing signal to the next person.

**Never set `TEST_DATABASE_URL` in a production environment.** It exists only so
the test tier can find a throwaway database, and that tier truncates tables.

---

## Production database

Any managed Postgres works — Neon, Supabase, Railway, Render, RDS. Two things
decide the setup:

**1. Use a pooled connection string.** Serverless functions open a connection
per instance and Postgres caps total connections in the low hundreds. A traffic
spike against a direct connection string exhausts the server and every request
starts failing at once. Every managed provider offers a pooler — Neon's `-pooler`
host, Supabase's port `6543`, RDS Proxy. Use it for `DATABASE_URL`.

Migrations are the exception: some poolers reject the session-level features DDL
needs. If `pnpm db:migrate:prod` misbehaves, point it at the **direct**
(non-pooled) URL and leave the app on the pooled one.

**2. Create the database before migrating.** Drizzle applies migrations; it does
not create the database itself.

`src/db/index.ts` already caches one pool per Node instance (`max: 10`) and drops
to `max: 1` on Cloudflare Workers, so no per-request connection churn is coming
from the app itself.

---

## Migrations

### The model

`src/db/schema.ts` is the single source of truth. You never write SQL by hand.
See [docs/database.md](docs/database.md) for the table catalogue, the invariants each one carries,
and the per-change checklist.

```bash
pnpm db:generate    # after editing schema.ts — writes src/db/migrations/NNNN_*.sql
pnpm db:migrate     # apply locally
```

Commit both the `.sql` file and the updated `meta/_journal.json`. Drizzle tracks
what has been applied in a `drizzle.__drizzle_migrations` table in the target
database, so migrations are applied exactly once per database.

### Do we migrate automatically on deploy? No.

This is the answer to the question and the reasoning is worth keeping:

- **A build is not a deploy.** Vercel builds every preview branch and can rebuild
  the same commit. Migrating from a build step means DDL firing from feature
  branches, in parallel, against production.
- **A build cannot stop a bad deploy.** If a migration half-applies, the build
  step has already handed the artifact off. You end up with new code live against
  a partially-migrated schema.
- **Order matters.** The safe sequence is migrate → verify → ship code. Only a
  separate step can enforce it.

Instead there is a one-click workflow: [.github/workflows/migrate.yml](.github/workflows/migrate.yml), run from the
Actions tab. Pick an environment and `check` (report what is pending) or `apply`.
`DATABASE_URL` is a GitHub *environment* secret, so staging credentials cannot
reach production, and adding required reviewers to the `production` environment
makes an apply need approval.

Locally or from any pipeline, the same runner:

```bash
DATABASE_URL=postgres://... pnpm db:check:prod
```

```bash
DATABASE_URL=postgres://... pnpm db:migrate:prod
```

[scripts/migrate.mjs](scripts/migrate.mjs) differs from `drizzle-kit migrate` in ways that matter for a
deployed database: it takes a Postgres **advisory lock** so two overlapping
deploys serialise instead of racing through the same DDL, it uses a single
connection, it redacts credentials from its output, it exits non-zero on any
failure, and it needs only runtime dependencies so it runs in a pruned install.

### Expand / contract

Because code and schema ship separately, there is always a window where the old
code runs against the new schema. Design migrations so that window is safe:

| Change | Wrong | Right |
| --- | --- | --- |
| Add a column | `NOT NULL` with no default | Nullable or defaulted; backfill; tighten in a later release |
| Rename a column | `ALTER ... RENAME` | Add new → write both → backfill → read new → drop old |
| Drop a column | Drop in the release that stops using it | Stop using it, ship, drop in the **next** release |
| Add a unique index | Plain `CREATE UNIQUE INDEX` on a big table | Deduplicate first, then `CREATE UNIQUE INDEX CONCURRENTLY` |

The rule: **every migration must leave the currently-deployed code working.** One
release expands the schema, a later one contracts it. Never both at once.

This is not hypothetical here. `email_provider_unique_idx` on
`users(email, signin_provider)` existed from migration 0000 but sat inert because
`signin_provider` was left null on insert, and a null is unique against
everything. `tests/db/users.identity.test.ts` now pins that behaviour.

### Rollback

There is no down-migration. Rolling *back* code is easy; rolling back a schema is
not. Expand/contract is what makes that acceptable — a forward-only schema that
the previous release can still run against means you can revert the deployment
without touching the database. If a migration is genuinely wrong, write a new
migration that corrects it.

Take a snapshot before anything destructive. Every managed provider has
point-in-time restore; know how to trigger yours *before* you need it.

---

## Deploying

Two apps deploy independently from one repository:

| App | Build | Serves |
| --- | --- | --- |
| Web | `pnpm build:web` | Public site, auth, checkout, API |
| Admin | `pnpm build:admin` (root dir `apps/admin`) | Admin console, `/api/admin/*` |

On Vercel that is two projects on the same repo. The admin project needs the same
`DATABASE_URL`, `BETTER_AUTH_SECRET`, and Turnstile keys — admin sign-in goes
through the same challenged endpoint — plus `NEXT_PUBLIC_ADMIN_WEB_URL` set to
its own origin.

Before opening a release PR or promoting a deployment, run the short checklist
in [docs/release-checklist.md](docs/release-checklist.md). It covers the command
gate plus the core manual smoke checks: signup, login, checkout, webhook,
credits, reservations, upload, localized homepage, and teammate invitation.

`pnpm build` runs `pnpm test:run` first via `prebuild`, so a broken test blocks a
deploy without any extra CI wiring.

### Background jobs

[vercel.json](vercel.json) registers a cron hitting `/api/cron/jobs` every 5 minutes, which is
what drains the `jobs` table (welcome emails, signup credits). Vercel sends
`CRON_SECRET` as an `Authorization` header automatically once it is set on the
project. **Off Vercel, you must schedule this yourself** — otherwise queued jobs
sit forever and users silently stop receiving welcome mail. Any scheduler works:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/jobs
```

### Stripe webhook

Point a Stripe webhook at `https://your-domain.com/api/pay/webhook/stripe` and
set `STRIPE_WEBHOOK_SECRET` from that endpoint's signing secret — the value
differs between the CLI and each deployed endpoint. Subscribe at minimum to
`checkout.session.completed`, `invoice.payment_succeeded`,
`invoice.payment_failed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`charge.refunded`, and `charge.dispute.created`.

---

## Known operational risks

**`SNOWFLAKE_WORKER_ID` is per-instance and defaults to `1`.** It seeds the ID
generator behind `credits.trans_no` and `orders.order_no`. On serverless, every
concurrent instance uses the same worker id, so two instances generating an ID in
the same millisecond can collide. The unique index turns that into a failed
insert rather than a corrupted ledger — the safe failure — but it is still a
user-visible error. If you outgrow a single instance, give each one a distinct
id, or move those IDs to UUIDv7.

**Email deliverability is a DNS problem, not a code problem.** SPF, DKIM, and
DMARC records must be verified at your sending provider before production mail
lands. See the email service guide in `/docs`.

---

## Checklists

### First production deploy

- [ ] Managed Postgres created; **pooled** URL for the app, direct URL noted for migrations
- [ ] `pnpm db:migrate:prod` run against it and verified with `pnpm db:check:prod`
- [ ] `BETTER_AUTH_SECRET` and `CRON_SECRET` generated fresh — not copied from `.env`
- [ ] Real Turnstile keys set on **both** the web and admin projects
- [ ] Resend domain verified (SPF + DKIM + DMARC), `EMAIL_FROM` on that domain
- [ ] Stripe webhook endpoint created, `STRIPE_WEBHOOK_SECRET` set from it
- [ ] Plus/Max monthly/yearly Stripe Price IDs configured and copied into the matching `STRIPE_PRICE_*` variables
- [ ] `NEXT_PUBLIC_WEB_URL`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_ADMIN_WEB_URL` set to real origins
- [ ] Cron scheduled against `/api/cron/jobs`
- [ ] Demo flags absent
- [ ] First admin promoted via SQL
- [ ] Point-in-time restore confirmed available

### Every schema change

- [ ] `src/db/schema.ts` edited, `pnpm db:generate` run, both files committed
- [ ] Migration reviewed for expand/contract safety — does the **currently deployed** code still work against it?
- [ ] `pnpm test:db` passes locally against `sushi_test`
- [ ] Migration applied via the workflow (`check`, then `apply`) **before** the code deploy is promoted
