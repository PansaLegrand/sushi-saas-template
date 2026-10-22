# Local Development

Use Node 24 LTS (`24.22.1` or a newer Node 24 patch) and pnpm `10.22.0`.
`nvm install && nvm use` selects the tested runtime from `.nvmrc`. CI and all
four container images use the same minimum runtime. After switching Node,
run `pnpm install --frozen-lockfile` to rebuild any native dependencies.

Database test files run in one worker with per-file isolation; do not remove
that serialization when upgrading the runner. The SaaS keeps Vitest 3 until
the Vitest 4 coverage migration can meet the existing branch threshold.
Vitest 4 recalculates previously uncounted branches; the threshold must not
be lowered to conceal that difference.

Dependency maintenance uses both PR dependency review and a weekly full
production dependency/runtime-image audit. Vite is a direct development
dependency so optional peer resolution cannot retain an older vulnerable copy.
The `@payloadcms/plugin-cloud-storage@3.90.2>find-node-modules` override removes
an unused declared dependency: none of that exact package's published runtime
files import it. The override is version-scoped so an upstream upgrade restores
normal dependency resolution and must be reviewed again. It removes the
unpatched `braces` path without replacing Payload's storage implementation.

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

On an interactive run, setup first opens `pnpm customize`. Its tracked
`saas.config.json` output becomes the default for product name/slug, style,
locales, support/docs links, and legal identity; environment setup then handles
deployment URLs and secrets. See [customization.md](customization.md).

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
tenant ledger, Garage upload/delete path, and the complete five-credit image
task from idempotent API replay through the durable worker to a signed private
result:

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

Better Auth 1.7.6 declares Vitest as an optional peer exclusively for its
`test-utils` export. This application and its tests do not import that export.
The version-scoped `.pnpmfile.cjs` hook keeps the development runner out of the production
dependency graph. The development runner is used in Node run mode only; do not
expose a Vitest browser/mock server while its major-version migration is pending.
# Optional application profiles

The existing `pnpm setup`, `pnpm dev:all`, and `pnpm build` commands retain the
complete stack. For a smaller adoption, choose a profile on each command:

| Profile | Processes and build targets |
| --- | --- |
| `core` | SaaS web and durable worker |
| `operations` | Core plus admin console |
| `publishing` | Operations plus Content Studio |

```bash
pnpm starter core install
pnpm starter core setup
pnpm starter core doctor
pnpm starter core dev
pnpm starter core build
pnpm starter operations build --dry-run
```

`install` uses the frozen lockfile and filters out the optional Studio workspace
for core/operations. `setup` skips Studio environment creation, database creation
and migrations for those profiles. Existing files and databases remain intact.
`doctor`, `dev`, `lint`, and `build` inspect or run the selected applications.
Builds retain the root test suite and bundle the durable worker runtime.

After a filtered install, export `SAAS_STARTER_PROFILE=core` (or `operations`)
in that shell so the ordinary `pnpm lint` and pre-commit hook use the same
selection. CI leaves it unset and validates the complete publishing stack.

Profiles are developer tooling choices, not product plans or runtime security
flags. Core still contains the application API, billing, organizations and
capability checks. It does not disable routes. Add Studio later by running the
publishing install/setup commands; keep its database and authentication separate.

PostgreSQL readiness probes use TCP. The container’s temporary initialization
server accepts Unix-socket connections before it shuts down and starts the
final server, so a socket-only probe is not a safe migration/startup gate.
