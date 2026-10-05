# Content Studio

`apps/content-studio` is the starter's authoring application. It is where
writers and SEO managers create pages, articles, content briefs, media, and
marketing campaigns. The Sushi SaaS presentation website is not its runtime and
does not import this code.

## Deployment boundary

Content Studio is a separate Payload/Next.js deployment on port `3002` locally.
It has its own Postgres database and editor authentication:

- `CONTENT_DATABASE_URL` belongs only to Payload.
- `DATABASE_URL` belongs only to the SaaS application.
- `PAYLOAD_SECRET` signs Content Studio sessions.
- `CONTENT_STUDIO_URL` lets the operational admin show the Publishing link.

Never point both applications at one database. Content documents may include
public editorial data; customer accounts, billing data, subscriber addresses,
consent, and delivery records remain in the SaaS database.

## Local development

```bash
./scripts/setup.sh development
pnpm dev:studio
```

The setup command creates `sushi_content`, writes the missing
`apps/content-studio/.env.development.local` profile, and applies its Payload
migrations. Existing environment values are preserved.

Open `http://localhost:3002/admin`. The first Payload user becomes the Content
Studio administrator. Run the SaaS and operational admin separately with
`pnpm dev` and `pnpm dev:admin`.

## Editorial model

- Pages use safe layout blocks and registered tool keys. Content cannot inject
  arbitrary HTML, CSS, JavaScript, or a new executable tool.
- Posts and pages support five locales, drafts, autosave, review, approval,
  preview, scheduled publishing, and version history.
- Content briefs keep keyword planning and generation inputs beside editorial
  work without publishing raw workflow data.
- Media can use local development storage or the configured private
  S3-compatible store.

An adopting product website consumes published documents through Payload's API
or the versioned content endpoints. `PUBLIC_SITE_REVALIDATE_URL` is optional and
must point to that product's website—not to the Sushi SaaS presentation site by
default.

## Automation API

Create a least-privilege Service Account in Content Studio and use Payload's
API-key header:

```text
Authorization: service-accounts API-Key <key>
```

The `/api/content/v1/*` API validates portable page/post input, creates and
updates drafts, submits review, publishes with a separate scope, queues batch
imports, manages briefs, and reports sanitized job state. Mutations require an
`Idempotency-Key`; replay protection is scoped to the service account and is
reserved before the write.

Payload also exposes collection REST APIs for
`/api/marketing-email-templates` and `/api/marketing-campaigns`. Marketing
service accounts need the corresponding `marketing:*` scopes. Launch is never
performed by a generic collection update; it uses the reviewed action endpoint
documented in [marketing-email.md](marketing-email.md).

## Schema workflow

After changing a Payload collection:

```bash
pnpm studio:generate
pnpm studio:migrate:create
pnpm studio:migrate
pnpm --dir apps/content-studio check
```

Commit the generated types, import map, migration TypeScript, and migration
JSON. Content Studio schema migrations are independent from Drizzle migrations
under `src/db/migrations`.

### Payload 3.90 upgrade

Apply `20261005_024231_payload_security_fields` with `pnpm studio:migrate`
against `CONTENT_DATABASE_URL` before deploying the updated Studio. Container
startup does not apply migrations. The migration only adds nullable columns:

- `users.reset_password_requested_at` records password-reset throttling.
- `media.prefix` stores the configured storage prefix, defaulting to `media`.
- `media._objectkey` stores Payload's `_objectKey` for per-upload storage folders.

Existing rows remain readable by the previous Studio version. Existing uploads
keep a null `_objectKey` and continue resolving through their prefix and filename;
the upgrade does not move stored objects. The S3 plugin always registers its
schema fields, even when storage credentials are absent, so local generation and
production migrations describe the same columns. Service accounts disable local
password authentication and do not receive password-reset columns.

Payload 3.90 also shows service-account API keys only when they are generated.
Capture the key at that point; subsequent document reads do not reveal it.
Re-create pending scheduled publish/unpublish events after upgrading, because
the task's user reference now includes its authentication collection. These
requirements come from the [Payload 3.90 release notes](https://github.com/payloadcms/payload/releases/tag/v3.90.0).
