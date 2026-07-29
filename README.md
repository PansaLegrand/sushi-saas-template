# Sushi SaaS Starter

A production-minded Next.js backbone for subscription and usage-based SaaS
products. It connects authentication, organizations, Stripe billing, pooled
credits, private storage, durable jobs, internationalization, and a separately
deployed admin console behind one enforced architecture.

This repository is the application starter. Public marketing, guides, and blog
content intentionally live in a separate documentation-site repository, so
content releases never require an application deployment.

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
- Docker for the default local PostgreSQL and Redis services

```bash
pnpm install
pnpm setup
pnpm dev
```

The application runs on `http://localhost:3000`. Start the admin console in a
second terminal:

```bash
pnpm dev:admin
```

The admin app runs on `http://localhost:3001`.

`pnpm setup` is idempotent: it creates local secrets only when `.env` does not
exist, starts the development services, and applies migrations.

## Configuration

Copy `.env.example` and configure at minimum:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `CRON_SECRET`
- `RATE_LIMIT_REDIS_URL` and `RATE_LIMIT_IP_SOURCE`
- `STRIPE_PRIVATE_KEY`, `STRIPE_WEBHOOK_SECRET`, a locked-down
  `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`, and Stripe Price IDs
- `RESEND_API_KEY` and `EMAIL_FROM`
- private object-storage credentials

Local auth links are logged when no email provider is configured. Production
validation fails closed when required credentials or anti-abuse controls are
missing.

The application renders an external documentation link only when
`NEXT_PUBLIC_DOCS_URL` is set. The docs website is not a submodule and is not
built by this repository.

## Essential commands

| Command                | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `pnpm dev`             | Start the SaaS application                                       |
| `pnpm dev:admin`       | Start the separate admin console                                 |
| `pnpm lint`            | Lint both applications                                           |
| `pnpm test:run`        | Run all test tiers; infrastructure tests skip without their URLs |
| `pnpm test:cov`        | Enforce coverage thresholds                                      |
| `pnpm test:db`         | Run real PostgreSQL and Redis invariant tests                    |
| `pnpm build`           | Test, then build the application and admin console               |
| `pnpm db:generate`     | Generate a Drizzle migration                                     |
| `pnpm db:migrate`      | Apply local migrations                                           |
| `pnpm db:check:prod`   | Fail on pending, drifted, or unexpected production migrations    |
| `pnpm db:migrate:prod` | Apply production migrations under an advisory lock               |

## Engineering documentation

The root `docs/` directory contains co-versioned operational runbooks—not the
public website:

- [Database and ledger invariants](docs/database.md)
- [Plans and entitlements](docs/plans.md)
- [Organizations and authorization](docs/organizations.md)
- [Error handling contract](docs/errors.md)
- [Storage providers](docs/storage-providers.md)
- [Release checklist](docs/release-checklist.md)
- [Deployment](DEPLOYMENT.md)
- [Test strategy](tests/README.md)
- [Admin deployment](apps/admin/README.md)

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
