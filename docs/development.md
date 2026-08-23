# Local Development

The default development loop is deliberately one command at each stage:

```bash
./scripts/setup.sh development
pnpm dev:doctor
pnpm dev:all
```

Setup is idempotent. It creates ignored environment profiles, starts the local
infrastructure, creates the app, test, Content Studio, and restore-drill
databases, migrates the first three, provisions a private S3-compatible bucket,
and leaves existing credentials untouched.

## Doctor

`pnpm dev:doctor` is read-only. It checks:

- supported Node and exact pnpm versions;
- private environment-file permissions and typed configuration;
- loopback-only development/test/Content Studio/restore database boundaries;
- Docker, PostgreSQL, Redis, and migration readiness;
- the local S3 endpoint, credentials, and private bucket;
- Content Studio's separate database and shared marketing credential;
- optional Stripe CLI availability and whether the three applications are
  already listening.

It prints variable names and remediation commands, never configured secret
values. A required failure exits non-zero, so the same command can gate a local
script or development container.

## Unified development runner

`pnpm dev:all` runs the web app, durable worker, admin console, and Content
Studio with prefixed logs. `Ctrl-C` terminates the complete process group rather
than leaving background processes behind.

```bash
pnpm dev:all
pnpm dev:all -- --web-only
pnpm dev:all -- --no-studio
pnpm dev:all -- --with-stripe
```

The runner executes `pnpm dev:doctor` first. `--skip-doctor` exists for deliberate
partial-stack work, not as the ordinary way to make a red preflight disappear.

## Browser contracts

After setup, Playwright starts an isolated web server on port `3100`, seeds the
demo account, signs in through the visible Better Auth form, and exercises the
tenant ledger and Garage upload/delete path:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

Use `pnpm test:e2e:ui` while authoring a flow. External environments require
`E2E_BASE_URL`, explicit credentials, and `E2E_ALLOW_MUTATIONS=1` before tests
that write data will run.

## Local object storage

Docker Compose runs [Garage](https://garagehq.deuxfleurs.fr/) on
`http://localhost:3900` and creates the private `sushi-dev` bucket. Setup adds
the development-only credentials and CORS policy automatically. The port is
bound to `127.0.0.1`; the repository-known credentials are never suitable for a
shared or production listener.

Garage is the maintained open-source local default because the
[MinIO Community repository](https://github.com/minio/minio) was archived and
its maintained AIStor successor requires a separate license. `minio` remains a
supported `STORAGE_PROVIDER` for teams that operate it themselves; only the
bundled default changed.

## Demo fixtures

```bash
pnpm dev:seed
```

The seed is idempotent and creates or repairs:

- `demo@example.test` / `DemoPass123!` through Better Auth;
- its verified personal organization;
- one deterministic 1,000-credit ledger grant;
- the demo consultation reservation service.

Override the password through `DEV_SEED_PASSWORD`, not a CLI flag that would
appear in the process list. `--email` accepts only reserved `.test` and
`.invalid` domains, and `--credits` is bounded to 1–100,000. The command refuses
anything except a loopback `sushi_dev` database.

## Safe reset

```bash
pnpm dev:reset -- --dry-run
pnpm dev:reset
```

Reset validates the exact local database names, Redis endpoint, Garage endpoint,
and bucket before offering to remove anything. It then requires the phrase
`reset local data`, removes only this Compose project's volumes, reruns setup and
migrations, and reseeds the demo fixtures. Environment profiles are preserved.

For automation, `--yes` replaces the interactive phrase. `--no-seed` recreates
empty infrastructure. The command refuses external databases or object storage,
even with `--yes`.
