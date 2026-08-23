# Sushi SaaS Starter

A production-minded Next.js backbone for subscription and usage-based SaaS
products. It connects authentication, organizations, Stripe billing, pooled
credits, private storage, durable jobs, internationalization, a separately
deployed admin console, and an optional Content Studio behind one enforced
architecture.

[Website](https://www.sushisaas.com) ·
[Documentation](https://www.sushisaas.com/docs) ·
[Quick start](https://www.sushisaas.com/docs/quick-start)

This repository is the application starter. Public marketing, guides, and blog
content live on the [Sushi SaaS website](https://www.sushisaas.com), whose
source is maintained in
[PansaLegrand/sushi-saas-site](https://github.com/PansaLegrand/sushi-saas-site),
so content releases never require an application deployment.

## What is included

| Area           | Included                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication | Better Auth email/password and Google OAuth, verified email, password recovery, session revocation, Turnstile, two-factor support            |
| Organizations  | Personal workspaces, invitations, owner/admin/member roles, last-owner and last-workspace concurrency guards                                 |
| Billing        | Stripe Price-based catalog, idempotent Checkout, Billing Portal, subscription lifecycle sync, webhook replay and out-of-order protection     |
| Credits        | Organization-pooled immutable ledger, atomic grants/spends/refunds, FEFO expiration, idempotent money mutations                              |
| Entitlements   | One capability service for plan access, limits, grace periods, and stacked subscriptions                                                     |
| Storage        | Private S3/R2/MinIO uploads, atomic quota reservation, signed downloads, durable object deletion                                             |
| Operations     | PostgreSQL migrations, Redis rate limits, durable job queue, liveness/readiness endpoints, structured redacted logs                          |
| Admin          | Separate Next.js app with read/write roles, mandatory MFA, audit trail, reconciliation, moderation, and responsive navigation                |
| Content Studio | Separate Payload app for pages, posts, SEO workflows, previews, automation APIs, and reviewed marketing campaigns                            |
| Quality        | Layer-boundary tests, route/service/component/infrastructure tiers, real Postgres and Redis CI, CodeQL, dependency review, OpenSSF Scorecard |

## Architecture

Application data flows in one direction:

```text
src/app/**       routes and pages — HTTP in, HTTP out
  ↓
src/services/**  business rules, orchestration, invariants
  ↓
src/models/**    typed CRUD; the only layer allowed to call db()
  ↓
src/db/**        schema, migrations, connection
```

Browser code follows a second explicit boundary:

```text
Server Component  → service directly
Client Component  → src/api/** → shared API client → /api/**
```

`tests/unit/architecture.test.ts` enforces these rules, organization scoping,
error boundaries, client transport conventions, and file naming.

## Quick start

Requirements:

- Node.js `>=20.19.0 <23`
- pnpm `10.22.0`
- Docker for the default local PostgreSQL, Redis, and S3-compatible services

```bash
./scripts/setup.sh development
pnpm dev:doctor
pnpm dev:all
```

The application runs on `http://localhost:3000`, the admin console on `:3001`,
and Content Studio on `:3002`. `pnpm dev:all` also drains durable jobs, prefixes
every process's logs, and stops the complete group on `Ctrl-C`.

Use `pnpm dev`, `pnpm dev:admin`, or `pnpm dev:studio` when working on only one
application.

The guided script installs dependencies, writes ignored development profiles,
generates internal secrets, optionally collects provider credentials, starts
PostgreSQL, Redis, and local S3 storage, provisions isolated app, test, Content
Studio, and restore-drill databases, and applies both Drizzle and Payload
migrations. It is idempotent and never replaces an existing value.

The interactive flow begins with `pnpm customize`, which writes the tracked
product identity, style, locale, support/docs, and legal-identity configuration.
Use `--dry-run` for an automation preview.

For CI or a no-prompts bootstrap, use `pnpm install && pnpm run setup`. Existing
clones using `.env` remain supported; fresh clones use
`.env.development.local` and
`apps/content-studio/.env.development.local`.

## Configuration

Configuration has one tracked inventory and separate ignored runtime profiles:

| Command                   | File                     | Purpose                                      |
| ------------------------- | ------------------------ | -------------------------------------------- |
| `pnpm env:setup:dev`      | `.env.development.local` | Local defaults and generated local secrets   |
| `pnpm env:setup:prod`     | `.env.production.local`  | Production values, isolated from development |
| `pnpm env:check:dev`      | development profile      | Validate types without printing values       |
| `pnpm env:check:prod`     | production profile       | Enforce the full production contract         |
| `./scripts/setup.sh prod` | production profile       | Guided setup plus validation; never deploys  |

`.env.example` remains the canonical list. Configure at minimum:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `CRON_SECRET`
- `RATE_LIMIT_REDIS_URL` and `RATE_LIMIT_IP_SOURCE`
- `STRIPE_PRIVATE_KEY`, `STRIPE_WEBHOOK_SECRET`, a locked-down
  `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`, and Stripe Price IDs
- `RESEND_API_KEY` and `EMAIL_FROM`; marketing delivery additionally uses the
  three secrets documented in [docs/marketing-email.md](docs/marketing-email.md)
- private object-storage credentials

Local auth links are logged when no email provider is configured. Production
validation fails closed when required credentials or anti-abuse controls are
missing.

The application renders an external documentation link only when
`NEXT_PUBLIC_DOCS_URL` is set. Point it to the adopting product's own
documentation site; it intentionally has no upstream default. The docs website
is not a submodule and is not built by this repository.

## Essential commands

| Command                  | Purpose                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| `pnpm setup:guided`      | Guided first-clone development setup                              |
| `pnpm customize`         | Configure product identity, style, locales, and legal data        |
| `pnpm config:check:prod` | Enforce environment-consistent, non-placeholder launch identity   |
| `pnpm dev:doctor`        | Diagnose toolchain, configuration, infrastructure, and migrations |
| `pnpm dev:all`           | Run web, worker, admin, and Content Studio with one supervisor    |
| `pnpm dev:seed`          | Create idempotent local demo account, credits, and catalog data   |
| `pnpm dev:reset`         | Guard, rebuild, migrate, and reseed the bundled local stack       |
| `pnpm env:check:prod`    | Validate production configuration without exposing secret values  |
| `pnpm dev`               | Start the SaaS application                                        |
| `pnpm dev:admin`         | Start the separate admin console                                  |
| `pnpm dev:studio`        | Start Content Studio on port 3002                                 |
| `pnpm jobs:work`         | Continuously drain durable jobs in a portable worker process      |
| `pnpm jobs:run`          | Run one bounded queue drain for a scheduler                       |
| `pnpm lint`              | Validate config/migrations and lint every application             |
| `pnpm test:run`          | Run all test tiers; infrastructure tests skip without their URLs  |
| `pnpm test:cov`          | Enforce coverage thresholds                                       |
| `pnpm test:db`           | Run real PostgreSQL and Redis invariant tests                     |
| `pnpm test:e2e`          | Run Playwright against the disposable full local stack            |
| `pnpm build`             | Test, then build the SaaS, admin, and Content Studio              |
| `pnpm studio:generate`   | Regenerate Payload admin imports and TypeScript types             |
| `pnpm studio:migrate`    | Apply Content Studio's separate Payload migrations                |
| `pnpm db:generate`       | Generate a Drizzle migration                                      |
| `pnpm db:migrate`        | Apply local migrations                                            |
| `pnpm db:check:prod`     | Fail on pending, drifted, or unexpected production migrations     |
| `pnpm db:migrate:prod`   | Apply production migrations under an advisory lock                |
| `pnpm db:lint`           | Validate snapshots and flag risky migration SQL                   |
| `pnpm db:integrity`      | Run a read-only orphan sweep over critical relationships          |
| `pnpm db:backup`         | Create a private custom dump and SHA-256 manifest                 |
| `pnpm db:restore:drill`  | Restore only into a confirmed scratch database                    |
| `pnpm retention:report`  | Preview operational rows eligible for retention                   |
| `pnpm containers:check`  | Validate hardened production Docker/Compose bundles               |

## Engineering documentation

The root `docs/` directory contains co-versioned operational runbooks—not the
public website:

- [Database and ledger invariants](docs/database.md)
- [Local development workflow](docs/development.md)
- [Product customization](docs/customization.md)
- [Observability and SLOs](docs/observability.md)
- [Background jobs](docs/background-jobs.md)
- [Backups, restore drills, and retention](docs/backups-and-retention.md)
- [Production containers](docs/containers.md)
- [Plans and entitlements](docs/plans.md)
- [Organizations and authorization](docs/organizations.md)
- [Error handling contract](docs/errors.md)
- [Storage providers](docs/storage-providers.md)
- [Release checklist](docs/release-checklist.md)
- [Deployment](DEPLOYMENT.md)
- [Test strategy](tests/README.md)
- [Admin deployment](apps/admin/README.md)
- [Content platform](docs/content-platform.md)
- [Marketing email](docs/marketing-email.md)

Behavior changes should update these runbooks in the same pull request. Public
guides should be changed in the detached documentation repository and linked
from the PR.

## Production responsibility

The starter supplies technical controls; it cannot choose product policy for
you. Before launch, complete the legal placeholders, decide retention and
account-erasure behavior, configure backups and restore drills, enforce CSP
after observing reports, protect the default branch, and run the manual Stripe,
auth, storage, and email checks in `docs/release-checklist.md`.

See [SECURITY.md](SECURITY.md) for private vulnerability reporting and
[CONTRIBUTING.md](CONTRIBUTING.md) for contribution rules.

## License

MIT
