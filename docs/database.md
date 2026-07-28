# Database Reference

The schema in [src/db/schema.ts](../src/db/schema.ts) is the single source of truth — 18 tables, no
hand-written SQL. This document explains what each table is for, the rules that
hold across all of them, and what to do when you change one.

Related: [DEPLOYMENT.md](../DEPLOYMENT.md) for migrations and environments, [tests/README.md](../tests/README.md) for the
database test tier that pins the invariants below.

---

## Setting up from a fresh clone

You need **two databases**: one for the app, one for the tests. They must be
separate — the test tier runs `TRUNCATE` before every test, so if it shared your
dev database it would erase your data on every `pnpm test:db`.

| Database | Env var | Purpose |
| --- | --- | --- |
| `sushi_dev` | `DATABASE_URL` | What `pnpm dev` reads and writes |
| `sushi_test` | `TEST_DATABASE_URL` | Wiped constantly. Holds nothing you care about |

Both live on the **same** Postgres server — same host, same port, same
credentials. Only the database name at the end of the URL differs.

### If you have no Postgres yet

```bash
pnpm install && pnpm setup
```

That writes `.env` with generated secrets, starts Postgres 16 in Docker, creates
both databases, and migrates them. Then `pnpm dev`.

### If you already have Postgres running

Very common — and `pnpm setup` detects it and stops rather than fighting for port
5432. Create the two databases on the server you already have:

```bash
createdb sushi_dev && createdb sushi_test
```

If it runs in a container, go through it instead:

```bash
docker exec <container-name> psql -U postgres -c "create database sushi_dev;" -c "create database sushi_test;"
```

Put both URLs in `.env`, matching your server's user, password, and port:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sushi_dev
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sushi_test
```

Then apply the schema to each:

```bash
pnpm db:migrate && pnpm test:db:setup
```

### Confirm it worked

```bash
pnpm test:db
```

23 tests should pass. If they **skip** instead, `TEST_DATABASE_URL` is not being
picked up — check it is in `.env` and that its database name contains `test`,
which the harness requires before it will truncate anything.

### Production

Bring your own database — any managed Postgres. Create it, set `DATABASE_URL`,
and run the migration workflow. Never set `TEST_DATABASE_URL` there. Details in
[DEPLOYMENT.md](../DEPLOYMENT.md).

---

## Ground rules

These are the non-obvious decisions. Break one and something downstream breaks
quietly.

### 1. There are no foreign keys

Not one table declares a foreign key. Relationships are plain `varchar` columns
holding a `user_uuid`, `order_no`, or `service_id`.

The consequences are real and you must code around them:

- **No cascade deletes.** Deleting a user leaves their credits, files, tasks,
  and reservations behind. Any deletion flow has to clean up explicitly.
- **No referential integrity.** Nothing stops a row pointing at a `user_uuid`
  that does not exist. Validate in the service layer.
- **Orphans are possible.** Budget for a reconciliation query, not a constraint.

This is a deliberate trade — Better Auth owns the `users` table lifecycle, and
the app tables are loosely coupled to it — but it is the single most important
thing to know before writing a delete path.

### 2. `uuid` is the identity, never `email`, rarely `id`

`users` carries two identifiers:

| Column | Owner | Use |
| --- | --- | --- |
| `id` | Better Auth | Session lookups only |
| `uuid` | The app | Everything else — every other table joins on this |

**Never resolve a user by email.** `users.email` is unique only *per
`signin_provider`*, so one address can legitimately have two rows. An email
lookup can return a different account than the session's — which, in an
authorization path, is an account takeover. `apps/admin/lib/authz.ts` resolves
roles strictly from the session uuid/id for exactly this reason.

### 3. The credit ledger is append-only

`credits` rows are immutable facts. Balance is `SUM(credits)` over the
organization's rows — grants positive, spends negative. There is no balance
column, and **nothing may `UPDATE` or `DELETE` a credits row.** A correction is a
new compensating row (see `refundCreditsForTransaction`).

`auth_events` and `admin_audit_logs` follow the same rule: append-only, never
edited.

**Three audit columns, added in `0018`, and two traps in them:**

| Column | Holds |
| --- | --- |
| `balance_after` | The running total of every row for the org, this one included |
| `actor` | Who caused it: `stripe:webhook`, `admin:<uuid>`, `user:<uuid>`, `system:<reason>` |
| `metadata_json` | Free-form JSON — the task a spend paid for, the transaction a refund reverses |

The first trap: **`balance_after` is not the spendable balance.** Credits expire
without writing a ledger row, so a spend-aware figure would drift from the sum by
design and a reconciliation script could not tell that apart from real
corruption. `balance_after` tracks the ledger total; `getOrgCredits` computes
what can actually be spent. They are allowed to disagree, and usually do.

The second: **`actor` is not `user_uuid`.** `user_uuid` is who the movement is
credited *to*; `actor` is who caused it. On an admin grant they are two different
people, which is the entire reason the column exists.

Both are only correct when written under the per-organization advisory lock, so
`src/models/credit.ts` owns every write and its insert type refuses a
caller-supplied `balance_after`. Do not insert into `credits` from anywhere else.
A null in any of the three means "written before `0018`", which a script must
treat as out of scope rather than as drift.

### 4. Idempotency lives in unique indexes, not in code

Every "must happen exactly once" guarantee is a database constraint. The code
catches the resulting `23505` and treats it as success. Full map:

| Constraint | Protects against |
| --- | --- |
| `credits.trans_no` unique | Double-granting signup credits, double-refunding |
| `jobs.dedupe_key` unique | Two welcome emails from one retried signup |
| `tasks (user_uuid, type, idempotency_key)` unique | Double-charging for a double-clicked task |
| `stripe_webhook_events.event_id` unique | Reprocessing a Stripe retry |
| `subscriptions.stripe_subscription_id` unique | Two rows for one Stripe subscription. Nullable, so comps (many NULLs) do not collide |
| `orders.order_no` unique | Duplicate orders |
| `reservations.reservation_no` unique | Duplicate bookings |
| `files (bucket, key)` unique | Two rows for one object |
| `users (email, signin_provider)` unique | One address claimed twice per provider |

If you remove or weaken one of these, the catch blocks that depend on it turn
into silent double-effects. `tests/db/` exists to make that impossible to do
accidentally.

### 5. Money is integer minor units

`orders.amount`, `reservation_services.price`, and `deposit_amount` are **cents**
(or the currency's minor unit), always `integer`. Never a float, never a decimal
string. Divide only at the display edge.

Credits are a separate unit with no fixed currency value — do not conflate them.

### 6. Stripe period columns are Unix seconds, not timestamps

`orders.sub_period_start`, `sub_period_end`, and `sub_cycle_anchor` are
`integer`, holding epoch seconds exactly as Stripe sends them. Everything else
in the schema is `timestamptz`. Do not "fix" these to timestamps without
migrating the values.

`subscriptions` is the exception that proves the rule: it stores the same
instants as `timestamptz`, because they are read on every entitlement check and
comparing epoch integers at each one is how a timezone bug gets in.

### 7. State copied from a webhook records the event's timestamp

`subscriptions.stripe_event_at` holds the moment Stripe *emitted* the event the
row was written from, not the moment we received it. Deliveries are retried for
days and arrive out of order, so the upsert compares this column and drops
anything older. Without it, a delayed `customer.subscription.updated` landing
after the `deleted` that followed it resurrects a cancelled subscription — the
user keeps a paid tier they no longer pay for, and nothing in the logs looks
wrong. Any future table that mirrors external state needs the same column.

---

## Table catalogue

Logical relationships — remember none of these are enforced foreign keys:

```mermaid
graph LR
  users[users] --- sessions
  users --- accounts
  users -.uuid.-> credits
  users -.uuid.-> orders
  users -.uuid.-> subscriptions
  users -.uuid.-> files
  users -.uuid.-> tasks
  users -.uuid.-> reservations
  users -.uuid.-> affiliates
  users -.uuid.-> auth_events
  orders -.order_no.-> credits
  tasks -.credits_trans_no.-> credits
  reservation_services -.service_id.-> reservations
  reservations -.order_no.-> orders
```

### Auth — owned by Better Auth

| Table | Purpose | Notes |
| --- | --- | --- |
| `users` | Accounts | Dual id (`id`/`uuid`). `role` is `user` / `admin_ro` / `admin_rw`. `last_signin_at` is denormalized from `auth_events`. Renaming a column here means updating `src/lib/auth.ts` field mapping. |
| `sessions` | Live sessions | Deleted on sign-out and expiry — cannot be used as a log. |
| `accounts` | Provider linkage + password hash | Unique on `(provider_id, account_id)`. |
| `verifications` | Email/reset tokens | Unique on `(identifier, value)`. |
| `auth_events` | Append-only signup / signin / email_verified log | Exists because `sessions` are deleted. Answers "how often does this user sign in". |

### Billing & credits

| Table | Purpose | Notes |
| --- | --- | --- |
| `orders` | Purchases — the immutable financial log | `status` is `created` / paid states. Subscription period columns are epoch seconds. Never rewritten after the fact; do not answer "what is this user entitled to" from it. |
| `subscriptions` | Current billing state, one row per subscription | What `orders` is not: rewritten in place on every Stripe event. `status` uses Stripe's own vocabulary. `source` is `stripe` or `manual` (a comp). `stripe_event_at` orders concurrent webhook deliveries (ground rule 7). Read through `src/services/entitlements.ts`, never directly. |
| `credits` | Append-only ledger | Positive = grant, negative = spend. `expired_at` null means never expires. `trans_type` values are the `CreditsTransType` enum in `src/services/credit.ts`. `balance_after` / `actor` / `metadata_json` are the audit columns — see ground rule 3, including the two traps in them. |
| `stripe_webhook_events` | Webhook idempotency + retry state, and the receipt | `status` `processing` / terminal; `attempts` counts retries. `payload` is the record of truth; the `stripe_*` id columns, `livemode`, `api_version`, and `request_id` are denormalized out of it at write time by `src/services/stripe/receipt.ts`, because a `text` column cannot answer "every event for this subscription" without a full scan. Indexed by customer, invoice, and subscription. Nulls are normal: no single event carries every id. |

### Storage & usage

| Table | Purpose | Notes |
| --- | --- | --- |
| `files` | S3/R2 object metadata | Lifecycle `uploading` → `active` → `deleted`. **Soft delete**: set `status='deleted'` and `deleted_at`; the row stays. Tenant ownership is `org_uuid`; the older `org_id` column is legacy and should not be used for authorization. |
| `tasks` | AI/usage work records | `credits_trans_no` traces the exact ledger row that paid for it. Idempotent per `(user_uuid, type, idempotency_key)`. |

### Operations

| Table | Purpose | Notes |
| --- | --- | --- |
| `jobs` | Durable queue drained by `/api/cron/jobs` | Claimed with `FOR UPDATE SKIP LOCKED`. `locked_at` allows reclaiming a job whose runner died. Backoff via `run_at`. `dedupe_key` is nullable and NULLs stay distinct, so un-deduped jobs are unaffected. |
| `admin_audit_logs` | Append-only admin action trail | `actor_email` is denormalized so the trail survives user edits. Every admin write must call `writeAdminAuditLog()`. |

### Product & growth

| Table | Purpose | Notes |
| --- | --- | --- |
| `affiliates` | Referral attribution and rewards | Amounts in minor units. |
| `feedbacks` | User feedback, read in the admin console | |
| `reservation_services` | Bookable service definitions (demo) | Prices in cents. |
| `reservations` | Bookings (demo) | `status` `pending` / `confirmed` / `canceled` / `expired`; `hold_expires_at` backs the pending hold. `policy_snapshot` freezes cancellation terms at booking time. |

### Dormant

| Table | Status |
| --- | --- |
| `posts` | **Unused.** `src/models/post.ts` has zero call sites; blog content is MDX under `content/`. Either wire it up or drop both in a contract migration. |
| `apikeys` | **Unused.** `src/models/apikey.ts` has zero call sites. Scaffolding for programmatic API access that was never finished. |

---

## Conventions

| Concern | Rule |
| --- | --- |
| Table names | Plural snake_case (`auth_events`, `reservation_services`) |
| Column names | snake_case, including in TypeScript — the Drizzle model mirrors SQL exactly |
| Index names | `<table>_<columns>_idx`, or `_unique_idx` for unique |
| Primary keys | `integer().primaryKey().generatedAlwaysAsIdentity()` for app tables; `varchar` for Better Auth tables |
| Public identifiers | A separate `uuid` column, unique. Never expose the integer `id` in an API |
| Timestamps | `timestamp({ withTimezone: true })` — always. No naked `timestamp` |
| `updated_at` | Set by application code. **There is no trigger.** If you write a row and skip it, it goes stale |
| Status columns | `varchar` with allowed values in a comment, not a Postgres enum — cheaper to extend. Validate in TypeScript |
| Text | `varchar({length})` when bounded, `text()` when not. JSON blobs are `text()` with a `_json` suffix |
| Booleans | `.notNull().default(...)` — avoid nullable booleans |

### Where code for a table lives

```
src/db/schema.ts       table definition
src/models/<domain>.ts typed CRUD helpers — the ONLY place raw queries belong
src/services/*.ts      orchestration; calls models, never db() directly
src/app/api/**         routes; call services, never models directly
```

Routes reaching past services into models, or services calling `db()` directly,
is the drift to watch for in review.

---

## Changing the schema

```bash
pnpm db:generate    # after editing src/db/schema.ts
pnpm db:migrate     # apply locally
```

Commit the generated `.sql` **and** `meta/_journal.json`. Never edit an applied
migration file — write a new one.

### Checklist for every schema change

- [ ] Edited `src/db/schema.ts`, not SQL by hand
- [ ] Ran `pnpm db:generate`; reviewed the generated SQL before committing
- [ ] **Expand/contract safe** — the currently deployed code still works against the new schema ([DEPLOYMENT.md](../DEPLOYMENT.md#expand--contract))
- [ ] Added a `src/models/<domain>.ts` helper rather than querying from a service or route
- [ ] Added an index for any column you filter or sort by at scale
- [ ] If you added a uniqueness guarantee, added a `tests/db/` test that proves it rejects a duplicate
- [ ] If you renamed a `users` column, updated the field mapping in `src/lib/auth.ts`
- [ ] Ran `pnpm test:db` against `sushi_test`

### Adding a table — the full path

1. Define it in `src/db/schema.ts` with the conventions above
2. `pnpm db:generate`
3. Add `src/models/<domain>.ts` with typed helpers
4. Call from `src/services/*`, then from a route
5. Add a route auth-gate test and, if the table carries an invariant, a `tests/db/` test
6. Add the table to this document

---

## Known issues — what to do later

Ordered by how much they will hurt.

1. **No foreign keys anywhere.** Adding them is an expand/contract job per table
   and needs an orphan sweep first. Highest-value fix, since it turns a class of
   silent data corruption into a loud error. Start with `credits.user_uuid` and
   `tasks.user_uuid`.

2. **No user-deletion path.** With no cascades, deleting a user today orphans
   rows in nine tables carrying `user_uuid`, plus `admin_audit_logs.actor_uuid`
   and the Better Auth tables. GDPR/CCPA erasure requests will force this; design
   it before someone asks. Decide per table: delete, anonymize, or retain
   (`credits` and `admin_audit_logs` are financial/audit records — likely retain
   with the uuid anonymized).

3. **`created_at` nullability is inconsistent.** Newer tables use
   `.notNull().defaultNow()`; older ones (`orders`, `credits`, `posts`,
   `affiliates`, `feedbacks`, `apikeys`) are nullable and set from application
   code. That means a forgotten field yields a null timestamp and breaks
   ordering. Backfill and tighten. **Do not copy the old pattern into new
   tables.**

4. **`posts` and `apikeys` are dead.** Drop them, or build the features. Dead
   tables mislead everyone who reads the schema next.

5. **`files.org_id` is legacy.** Tenancy now uses `org_uuid` across application
   tables. `files.org_id` remains as an older placeholder column and should be
   dropped in a contract migration once no deployed code can reference it.

6. **No retention policy on the append-only tables.** `auth_events`,
   `admin_audit_logs`, and `jobs` grow forever. `jobs` alone has pruning
   (`pruneFinishedJobs`, 14 days). Decide retention for the other two before
   they are large enough that adding an index requires a maintenance window.

7. **`getSnowId()` collides across instances.** It seeds `credits.trans_no` and
   `orders.order_no` from `SNOWFLAKE_WORKER_ID`, which defaults to `1` on every
   serverless instance. The unique index turns a collision into a failed insert
   rather than a corrupted ledger, but it is still a user-visible 500. UUIDv7
   would remove the problem.

8. **Status columns have no CHECK constraints.** Allowed values live in comments
   and TypeScript. A bad direct `UPDATE` in psql will happily write nonsense.
   Low priority while all writes go through the app.

---

## Raw SQL and `db().execute()`

Almost every query goes through Drizzle's query builder, which converts
JavaScript values to Postgres types for you. One place does not:
`claimDueJobs` in `src/models/job.ts` uses a raw `sql` template because
`FOR UPDATE SKIP LOCKED` has no builder equivalent.

**`db().execute()` sends the statement down postgres.js's unsafe path, which has
no type handler for `Date`.** Passing one throws:

```
The "string" argument must be of type string or an instance of Buffer or
ArrayBuffer. Received an instance of Date
```

This is not a compile error and not something a mocked test can see — it
silently broke the entire job queue until `tests/db/jobs.queue.test.ts` ran
against a real database for the first time. Since nothing drained the `jobs`
table, no welcome email and no signup credit grant would ever have been
delivered in production.

If you write raw SQL, convert values yourself:

```ts
const nowIso = new Date().toISOString();
sql`... where run_at <= ${nowIso}::timestamptz`;
```

Always add a `tests/db/` test alongside raw SQL. It is the only tier that
executes the statement.
