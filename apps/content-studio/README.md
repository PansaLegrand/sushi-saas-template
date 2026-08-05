# Sushi Content Studio

This Payload application is part of the SaaS starter repository. It owns
editorial pages, blog posts, media, content briefs, marketing email, previews,
and content automation. It deploys independently and does not share a database
or authentication session with the customer-facing SaaS application.

## Local setup

```bash
pnpm install
pnpm run setup
pnpm dev:studio
```

Run those commands from the repository root. `pnpm run setup` creates the
Studio's isolated local database and `apps/content-studio/.env.local` without
replacing an existing file. To configure the app manually, copy this directory's
`.env.example`, then run `pnpm migrate` here.

The local studio runs at `http://localhost:3002`; the SaaS app uses `3000`, and
the operational admin uses `3001`. The admin's Publishing navigation links to
the Studio through `CONTENT_STUDIO_URL`.

The first account created at `/admin` becomes an administrator. Later accounts
receive the writer role by default.

## Machine authentication

Create a Service Account in the studio, give it only the scopes its workflow
needs, and generate an API key. Payload's authorization header format is:

```text
Authorization: service-accounts API-Key <key>
```

Draft and batch mutations also require an `Idempotency-Key` header. Keys are
scoped to the service account and reserved before work begins, so concurrent
workflow retries cannot create duplicate drafts or jobs.

The versioned API supports draft create/read/replace, review submission,
explicitly scoped publishing, batch import jobs, content briefs, marketing
campaign validation and audience counts, test delivery, consent-aware launch,
delivery status, and cancellation. See
`docs/content-platform.md` and `docs/marketing-email.md` at the repository root.

## Commands

- `pnpm generate` regenerates the admin import map and `src/payload-types.ts`.
- `pnpm migrate:create` creates a migration after a schema change.
- `pnpm migrate` applies committed migrations.
- `pnpm jobs:run` processes queued content imports outside the built-in runner.
- `pnpm check` runs generation, lint, type checking, tests, and a production build.

See the repository-level engineering docs for the API and deployment contract.
