# Background Jobs

The `jobs` table is the starter's durable queue. Enqueueing persists intent
before a request returns; workers claim rows with `FOR UPDATE SKIP LOCKED` and a
lease timestamp, so a crashed process can be recovered and multiple runners can
drain safely without executing the same lease.

## Choose a Runner Mode

Use exactly one default mode per environment:

| Environment               | Recommended runner                         | Command or endpoint           |
| ------------------------- | ------------------------------------------ | ----------------------------- |
| Local development         | Dedicated worker started by `pnpm dev:all` | `pnpm jobs:work`              |
| VM, container, Kubernetes | Dedicated worker process                   | `pnpm jobs:work --production` |
| Platform scheduler        | One bounded process                        | `pnpm jobs:run --production`  |
| Vercel                    | Authenticated HTTP cron                    | `POST /api/cron/jobs`         |

Concurrent runners are safe. A full worker batch immediately attempts another
drain; an incomplete batch waits for `JOB_WORKER_POLL_MS`. `SIGINT` and
`SIGTERM` let the current handler finish, stop new claims, and close the database
pool.

`--production` sets `NODE_ENV=production` before application modules load, so
the worker enforces the same required-secret and provider configuration contract
as the deployed web process. Do not omit it merely because a container happens
to export a production database URL.

The worker configuration defaults are:

| Variable                             |  Default | Meaning                               |
| ------------------------------------ | -------: | ------------------------------------- |
| `JOB_WORKER_POLL_MS`                 |   `2000` | Idle polling interval                 |
| `JOB_WORKER_BATCH_SIZE`              |     `25` | Maximum jobs per bounded drain        |
| `JOB_WORKER_HANDLER_TIMEOUT_MS`      |  `20000` | Maximum time for one provider handler |
| `JOB_WORKER_DRAIN_DEADLINE_MS`       |  `40000` | Maximum time for one drain cycle      |
| `JOB_WORKER_MAINTENANCE_INTERVAL_MS` | `300000` | Cleanup and provider-sweep interval   |

Keep the handler timeout below the five-minute lease. A handler that exceeds its
timeout is aborted and retried through the normal exponential-backoff path.

## Reference Paid Workflow: Image Generation

Image generation is the minimal end-to-end example for a paid asynchronous
feature. One accepted task costs exactly five pooled organization credits and
uses stable identities at every boundary:

- `(user_uuid, type, idempotency_key)` identifies the task and a request
  fingerprint rejects reuse with different input;
- `task_image:<task uuid>` identifies the ledger spend, so a concurrent replay
  returns the original debit;
- `task_image_generation:<task uuid>` deduplicates durable dispatch;
- the task UUID also identifies its private file row and deterministic object
  key, so a retry after object upload repairs the database link instead of
  generating a second artifact.

The state machine is `pending_payment → queued → running → succeeded`. Provider
failures return to `queued` for the first four attempts. On the fifth failure,
the worker moves the task to `refunding`, applies the ledger's deterministic
compensation, and only then records `failed`. The job has eight attempts, leaving
three attempts exclusively for compensation if the database is temporarily
unavailable. Replaying a `refunding` task never calls the provider again.

Locally, enable `ENABLE_DEMO_FEATURES=true` and
`ENABLE_IMAGE_GENERATION_MOCK=true`. `IMAGE_GENERATION_MOCK_FAILURES=N` makes
the first N provider attempts fail so retry and refund behavior can be tested
without an external account. Production ignores the mock flag; replace only
`src/services/ai/image.ts` with a provider adapter that honors the supplied
idempotency key and abort signal.

## Operator Workflow

The admin console's `/jobs` page exposes operational metadata but never payload
JSON or deduplication keys. Operators can:

- retry a `failed` job, which resets attempts and schedules it immediately;
- cancel a standalone pending notification that no worker has claimed;
- inspect due age, failed jobs, stale leases, subjects, and last errors.

Both writes require `admin_rw`, same-origin protection, a reason, and an audit
entry. Credits, storage cleanup, account lifecycle, and campaign delivery must
be canceled through their owning workflow so related state is updated too. The
generic actions are atomic status transitions: if a worker or another operator
wins the race, the stale action is refused. Running jobs are not cancelable
because a provider effect may already be in flight.

## Alerts and Recovery

`GET /api/ready` becomes degraded when any job is failed or stale-running, or
when the oldest due job has waited more than ten minutes. Alert on the same
signals and link responders to `/jobs`.

When the queue is unhealthy:

1. Confirm at least one runner is alive and can connect to PostgreSQL.
2. Check `oldestDueAgeMs`, `staleRunning`, and `failed` from readiness.
3. Fix the provider or configuration error shown in structured logs.
4. Retry only handlers whose external effect is idempotent. The shipped handlers
   use stable job UUIDs for provider idempotency where supported.
5. Leave a note in the admin action so the audit trail explains the intervention.

Both runner modes invoke the same maintenance service: finished-job and provider
receipt retention, stale-upload cleanup, and Stripe webhook sweeps. Retention
periods are configured through `RETENTION_*_DAYS`; see
[backups-and-retention.md](backups-and-retention.md). Operational job history is
not the product's permanent audit ledger.
