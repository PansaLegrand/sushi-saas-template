# Production Containers

The repository ships separate production images for the web application, admin
console, durable worker, and optional Content Studio. They share code and secrets
where required, but they remain separate processes with independent scaling and
release decisions.

| Artifact       | Dockerfile          | Default port | Purpose                                      |
| -------------- | ------------------- | -----------: | -------------------------------------------- |
| Web            | `Dockerfile.web`    |         3000 | Customer UI and public/API routes            |
| Admin          | `Dockerfile.admin`  |         3001 | MFA-protected operator console and admin API |
| Worker         | `Dockerfile.worker` |         none | Durable jobs and recurring maintenance       |
| Content Studio | `Dockerfile.studio` |         3002 | Optional Payload authoring deployment        |

PostgreSQL, Redis, and object storage are not included in the production
Compose file. Production data services should be managed, backed up, encrypted,
and independently reachable during application rollouts.

## Build and Start

Prepare and validate the product and production profile first:

```bash
pnpm customize
./scripts/setup.sh production
pnpm containers:check
```

Compose needs the profile twice: `--env-file` supplies build-time interpolation
for public `NEXT_PUBLIC_*` values, while `APP_ENV_FILE` mounts the same values and
runtime secrets into the containers.

```bash
APP_ENV_FILE=.env.production.local \
docker compose --env-file .env.production.local \
  -f compose.production.yml build web admin worker

APP_ENV_FILE=.env.production.local \
docker compose --env-file .env.production.local \
  -f compose.production.yml up -d web admin worker
```

For prebuilt registry images, set `WEB_IMAGE`, `ADMIN_IMAGE`, and `WORKER_IMAGE`
and add `--no-build`. The optional authoring app uses a separate profile and
separate environment file:

```bash
APP_ENV_FILE=.env.production.local \
CONTENT_ENV_FILE=apps/content-studio/.env.production.local \
docker compose --env-file .env.production.local --profile studio \
  -f compose.production.yml up -d
```

Because the Studio container filesystem is read-only, container deployments
must configure the complete `CONTENT_STORAGE_*` S3-compatible block. A local
disk media directory is suitable for development, not for an ephemeral or
horizontally scaled authoring container.

`NEXT_PUBLIC_*` values are baked into Next.js during image creation. They are
build arguments because they are public by definition. Database passwords,
Stripe/Resend keys, auth secrets, and storage credentials are runtime-only;
never add them as Docker build arguments or `ENV` instructions.

## Migrations Are a Separate Release Step

No image runs migrations from `CMD` or `ENTRYPOINT`. Apply and verify them before
promoting application containers:

```bash
APP_ENV_FILE=.env.production.local \
docker compose --env-file .env.production.local -f compose.production.yml \
  run --rm worker node scripts/migrate.mjs

APP_ENV_FILE=.env.production.local \
docker compose --env-file .env.production.local -f compose.production.yml \
  run --rm worker node scripts/migrate.mjs --check
```

The worker and migration runner are bundled during the image build. The final
image contains no package manager, source TypeScript, `node_modules`, or dev/test
tooling. Non-container production CLI installs still keep `tsx` and `cross-env`
as runtime dependencies because the documented commands must survive
`pnpm install --prod`.

## Runtime Hardening and Health

- Every final image uses a pinned Node 20 Alpine base and a non-root UID.
- Compose drops Linux capabilities and sets `no-new-privileges`.
- Web/admin/studio filesystems are read-only with bounded cache/tmp tmpfs mounts.
- Web health uses `/api/health`; external readiness monitoring should use
  `/api/ready` so database, Redis, migration, and queue degradation is visible.
- Admin health uses `/login`, which verifies the independently deployed Next
  process without requiring an operator session.
- `SIGTERM` gives the worker 60 seconds to finish its current handler and close
  the database pool before Compose stops it.

Terminate TLS and set request/body limits at a trusted reverse proxy or load
balancer. Bind defaults are loopback-only; change `WEB_BIND`, `ADMIN_BIND`, and
`STUDIO_BIND` only when the host firewall and proxy topology require it.

Scale web and worker independently. Multiple workers are safe because job claims
use `FOR UPDATE SKIP LOCKED`; keep one maintenance interval per worker fleet and
monitor the queue signals documented in [observability.md](observability.md).

## Verification

`pnpm containers:check` validates all Compose profiles plus static guarantees:
standalone Next output, pinned runner image, non-root users, excluded environment
files, and no migration command in container startup. CI runs this check on every
change.
