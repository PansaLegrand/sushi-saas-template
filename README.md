<div align="center">

# Sushi SaaS - a serious SaaS backbone for business ideas

A production-minded Next.js starter kit with auth, billing, organizations, credits,
admin tools, storage, i18n, docs, background jobs, and tests already wired together.

<br/>

<p>
  <img alt="Next.js" src="public/imgs/logos/nextjs.svg" height="28" />
  &nbsp;&nbsp;
  <img alt="React" src="public/imgs/logos/react.svg" height="28" />
  &nbsp;&nbsp;
  <img alt="Tailwind CSS" src="public/imgs/logos/tailwindcss.svg" height="28" />
  &nbsp;&nbsp;
  <img alt="shadcn/ui" src="public/imgs/logos/shadcn.svg" height="28" />
  &nbsp;&nbsp;
  <img alt="Vercel" src="public/imgs/logos/vercel.svg" height="28" />
  <br/>
  <sub>Next.js 15, React 19, Drizzle, Better Auth, Stripe, next-intl, Fumadocs, Resend, S3-compatible storage</sub>
  <br/>
  <br/>
  <a href="https://www.sushi-templates.com/en/docs" target="_blank" rel="noreferrer noopener">Read the Docs</a>
  &nbsp;&nbsp;
  <a href="https://www.sushi-templates.com/en/docs/quick-start" target="_blank" rel="noreferrer noopener">Quick Start Guide</a>
</p>

<p>
  <a href="README.es.md">Español</a>
  ·
  <a href="README.fr.md">Français</a>
  ·
  <a href="README.ja.md">日本語</a>
  ·
  <a href="README.zh.md">中文</a>
</p>

</div>

## Why This Kit

Sushi SaaS is built for founders and engineers who want to start from a real
application backbone, not a landing page with a checkout button. The core
systems are already connected: a user signs up, joins a workspace, upgrades a
plan, spends credits, uploads private files, triggers jobs, and can be managed
from a separate admin app.

The useful part is not just the feature count. The repo has clear boundaries,
typed data access, explicit migrations, no-leak error handling, and tests that
enforce the architecture. That makes it a safer base for multiple business
ideas, client projects, AI tools, marketplaces, reservation products, or
internal SaaS dashboards.

## What You Get

| Area | Included |
| --- | --- |
| Authentication | Email/password, Google OAuth, email verification, password reset, Cloudflare Turnstile, auth event logs, local development auth links |
| Admin security | Separate admin Next.js app, `admin_ro` / `admin_rw` roles, admin MFA requirement, read/write guards, admin audit logs |
| Billing | Stripe Checkout, Billing Portal, subscriptions, cancel/downgrade/dunning handling, out-of-order webhook protection |
| Plans | Free/plus/max tiers, entitlement checks, usage limits, comped accounts, org-owned billing |
| Organizations | Personal workspaces, teams, invitations, member roles, last-owner protection, pooled credits |
| Credits | Ledger-based grants and spends, expiry-aware balances, idempotent credit mutations |
| Product modules | Reservations, affiliates/referrals, feedback collection, text-to-video task scaffold |
| Storage | Private S3/R2/MinIO-compatible uploads, presigned URLs, soft delete, owner-scoped downloads |
| Content | Fumadocs docs, optional MDX blog, sitemap generation, SEO metadata |
| Internationalization | Locale routing and message catalogs for English, Spanish, French, Japanese, and Chinese |
| Operations | Health endpoint, background jobs table, Vercel cron runner, production migration script |
| Quality gates | ESLint, Vitest tiers, real Postgres DB tests, architecture tests, CI workflow, Husky pre-commit hooks |

## Built To Be Extended

The repo uses a horizontal architecture:

```txt
src/app/**       routes and pages
src/services/**  business logic and invariants
src/models/**    typed CRUD and the only layer that calls db()
src/db/**        schema, migrations, connection
```

This is enforced by `tests/unit/architecture.test.ts`. New product domains
should follow the existing pattern: model helpers in `src/models`, business
rules in `src/services`, browser API wrappers in `src/api`, and presentation in
`src/components`.

Two other boundaries matter:

- The public web app and admin app are separate. Public routes do not own
  `/admin` pages or `/api/admin/*`; those live under `apps/admin`.
- The starter kit and its documentation site are separate modes. `app` mode runs
  the SaaS product. `site` mode runs the public docs/marketing site without
  requiring a database.

## Run Locally

Requirements:

- Node.js `>=20.19.0 <23`
- pnpm `10.22.0`
- Docker, for the default local Postgres setup

```bash
pnpm install
pnpm setup
pnpm dev
```

`pnpm setup` creates `.env` with generated local secrets, starts Postgres through
Docker, and applies migrations. It is safe to re-run and never overwrites an
existing `.env`.

The public web app runs at:

```txt
http://localhost:3000
```

Run the admin app separately:

```bash
pnpm dev:admin
```

The admin app runs at:

```txt
http://localhost:3001
```

For local admin auth URLs, keep this in `.env`:

```bash
NEXT_PUBLIC_ADMIN_WEB_URL=http://localhost:3001
```

## Development Email

Email verification is required, but local development should not be blocked by
Resend setup. If `RESEND_API_KEY` or `EMAIL_FROM` is missing outside production,
verification and password reset links are printed through the app logger. In
production, configure a real email provider.

```bash
RESEND_API_KEY=
EMAIL_FROM="Your Name <founder@your-domain.com>"
```

## Admin Access

Admin access is controlled by `users.role`:

- `admin_ro` can read admin data.
- `admin_rw` can read and perform write actions such as granting credits.

Admin accounts must enable two-factor authentication before they can enter the
admin console. Enable MFA from the public account page, then sign in to the
admin app and complete the two-factor challenge.

For now, the first admin role is still assigned manually in the database. The
roadmap tracks a small `pnpm admin:promote <email>` command as the next quality
of life improvement.

## Deployment Notes

Read [DEPLOYMENT.md](DEPLOYMENT.md) before shipping. The short version:

- Run `pnpm db:check:prod` before applying migrations.
- Run `pnpm db:migrate:prod` deliberately; migrations are not automatic on
  deploy.
- Deploy the public app and admin app as separate services or Vercel projects.
- Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CRON_SECRET`, Stripe, Resend, and
  storage credentials in production.
- Keep storage private and serve downloads through short-lived signed URLs.
- Apply migration `0017` before expecting admin MFA to work on an existing
  database.

## Essential Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the public web app |
| `pnpm dev:admin` | Run the admin app on port `3001` |
| `pnpm dev:site` | Run the docs/marketing site mode on port `3002` |
| `pnpm lint` | Lint web and admin apps |
| `pnpm test:run` | Run the default Vitest suite |
| `pnpm test:cov` | Run coverage checks |
| `pnpm test:db` | Run real Postgres database tests |
| `pnpm build` | Run tests, then build web and admin apps |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Apply local migrations |
| `pnpm db:check:prod` | Check pending production migrations |
| `pnpm db:migrate:prod` | Apply production migrations with the repo runner |

## Documentation Map

| Document | Covers |
| --- | --- |
| [docs/database.md](docs/database.md) | Schema reference, invariants, and the checklist for changing tables |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Environments, database hosting, and production migration workflow |
| [tests/README.md](tests/README.md) | Test tiers and rules for mocks, DB tests, auth gates, and replay tests |
| [docs/errors.md](docs/errors.md) | Error catalog, translated messages, and the no-leak server/UI contract |
| [docs/plans.md](docs/plans.md) | Plans, tiers, entitlements, and feature limits |
| [docs/organizations.md](docs/organizations.md) | Tenancy, personal workspaces, team billing, roles, and pooled credits |
| [apps/admin/README.md](apps/admin/README.md) | Admin app deployment, access control, audit trail, and admin APIs |

The public project website at
[sushi-templates.com](https://www.sushi-templates.com) is the documentation home
for this starter kit. It explains the project and setup flow; it is not a live
showcase deployment of a customer product.

## Content Ownership

There are two independent Fumadocs collections:

| Collection | Route | Owner |
| --- | --- | --- |
| `content/docs` | `/docs` | Starter-kit documentation that ships with the repo |
| `content/blog` | `/blogs` | Your own articles, SEO pages, and announcements |

`content/blog` ships empty on purpose. Emptying it is the supported way to
remove previous site content from a fresh clone.

Site-specific identity belongs in one place:

- `src/config/site.ts` for brand, docs nav, repository URL, contact email, and
  showcases
- `messages/*.json` under `landing.*` and `metadata.*` for translated landing
  copy
- `public/imgs` and `public/robots.txt` for assets and crawler policy

Generate a sitemap for your domain with:

```bash
SITEMAP_BASE_URL=https://your-domain.com pnpm gen:sitemap
```

## Examples And Docs

- DojoClip: https://dojoclip.com - a browser-based video editing product with
  multilingual subtitles.
- Sushi Templates: https://www.sushi-templates.com - the documentation site for
  this starter kit, not a live showcase product.

## Current Readiness

This is already a strong starting point for a SaaS product: auth, billing,
tenancy, credits, storage, admin, docs, jobs, and tests are in place. The
remaining starter-readiness work is tracked in [roadmap.md](roadmap.md). The
most important next items are making a fresh clone run without Docker, adding
production error tracking/structured logs, and adding the admin promotion script.

## License

MIT - contributions welcome.
