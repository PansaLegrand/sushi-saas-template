# Admin App

The admin console is a separate Next.js app so public web routes and admin-only operational routes can deploy independently. The public web app does not own `/admin` pages or `/api/admin/*`; this app owns the admin UI, admin auth entrypoint, RBAC guard, and admin-only APIs.

## Commands

- `pnpm dev:admin` runs the admin app on port `3001`.
- `pnpm build:admin` builds only the admin app.
- `pnpm start:admin` starts the built admin app on port `3001`.

## Environment

Set `NEXT_PUBLIC_ADMIN_WEB_URL` to the admin origin for local and production admin deployments.

For local development:

```bash
NEXT_PUBLIC_ADMIN_WEB_URL=http://localhost:3001
```

When that value exists, this app points Better Auth at the admin origin unless `BETTER_AUTH_URL` or `NEXT_PUBLIC_AUTH_BASE_URL` are explicitly provided by the shell/deployment environment.

## Access Control

Admin roles are stored in `users.role`:

- `admin_ro` can read admin data.
- `admin_rw` can read admin data and perform write actions.

Admin users must also enable Better Auth two-factor authentication before the
admin console authorizes them. Without MFA, a signed-in admin role is redirected
to `/mfa-required`; after enabling two-factor auth from the public account page,
they can complete the admin `/two-factor` challenge and continue.

The admin guard lives in `apps/admin/lib/authz.ts` and loads the current role from the database. Do not trust role values from the client.

Admin sign-in goes through the same `/sign-in/email` endpoint as the public app, so the Cloudflare Turnstile challenge applies here too. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` must be set for this app as well, or admin login will be rejected with `Missing CAPTCHA response`.

The role is resolved strictly from the session's user uuid or id. It is never resolved by email: `users.email` is only unique per `signin_provider`, so an email lookup can return a different account than the session's.

### Promoting an account that signed up with Google

An account created through OAuth has no password, and Better Auth requires one
to enable two-factor auth — so a Google-only operator used to be stuck: promoted
to `admin_rw`, unable to turn on MFA, and therefore unable to open the console.
The error said `INVALID_PASSWORD`, which reads as a typo rather than as "there
is no password to get right".

The account page now detects this and offers **Set a password** in place of the
confirm-password prompt, backed by `POST /api/account/password`. That endpoint
only ever sets a *first* password — changing a known one goes through Better
Auth's `changePassword`, which re-authenticates — so a stolen session cannot use
it to overwrite a real password. Signing in with Google keeps working
afterwards; the password exists to satisfy the MFA prompt.

`Forgot password` reaches the same end state: the reset flow creates the
`credential` account when none exists.

## Audit Trail

Every admin write action must be recorded via `writeAdminAuditLog()` in `apps/admin/lib/audit.ts`, which appends to the `admin_audit_logs` table. Entries capture the actor, action, target, note, IP, user agent, and a metadata blob, and are readable at `/audit`. The helper never throws, so a logging failure cannot mask the action's result.

Write actions must also be idempotent. `POST /api/admin/credits/grant` requires an `idempotencyKey` per attempt and derives a deterministic `credits.trans_no` from it, so a retry or double-click cannot credit twice.

## Expiration Controls

Complimentary plans and manual credit grants share the same expiration picker.
**Never** is the default: a manual plan stays active until an admin revokes it,
and unused granted credits remain spendable until they are consumed. The 7, 30,
and 90 day shortcuts count forward from the current moment. A custom calendar
choice defaults to 23:59 in the operator's local timezone and is converted to an
ISO timestamp before it is sent. The confirmation text shows the exact timezone
and explains what happens when the expiration is reached.

Both APIs reject timestamps that are already in the past. This is deliberate:
accepting one would report a successful write whose plan or credit balance is
already expired.

## Finding a User

Every write tool in the console — grant credits, comp a plan, suspend an account
— is keyed on `users.uuid`. `/users` is where an operator turns whatever they
arrived with into one: it searches `email`, `uuid`, and `nickname` with `ilike`,
and pages at 50. The overview's table is still only the newest 20 and links here.

Two things are deliberate. The search covers `uuid` and not only `email` because
one address can hold several accounts — `users.email` is unique per
`signin_provider` — so an address search returns every provider's row, which is
what you want before suspending. And it does **not** search `signin_ip` or
`stripe_customer_id`: a Stripe customer belongs to the organization, where
`/organizations` already searches for it.

Results come through the column allowlist in `apps/admin/lib/data.ts`, so
`signin_ip`, `signin_openid`, `stripe_customer_id`, and `invite_code` never
reach the browser. `tests/db/admin.users.test.ts` asserts that on the row keys —
the way it breaks is a bare `select()` added by someone who needed one more
column.

## Moderation

`/moderation` suspends abusive accounts and manages the signup blocklist. Two
things about it are easy to get wrong and are worth knowing before you use it.

**A suspension is not a delete, deliberately.** It blocks sign-in and revokes
every live session; it leaves the user row, the credit ledger, the uploads, and
the organizations alone. Deleting during an abuse wave helps the attacker — it
frees the address to register again and destroys the signup IPs and timestamps
that identify the rest of the wave. Erasing someone's data on request is a
separate operation with a policy behind it and is not implemented; see the
account-deletion item in [roadmap.md](../../roadmap.md).

**Banning one account is not enough on its own.** `users.email` is unique per
`signin_provider`, so one address can hold several accounts, and a fresh OAuth
signup would create an unbanned row. Two things close that:

- the ban applies to *every* account sharing the address, not just the uuid
  given;
- it adds an `email_blocklist` entry by default, which is what stops a new
  registration. Turning that off leaves the address free to sign up again.

The blocklist is enforced in Better Auth's `user.create.before` hook, so it
covers OAuth signup as well as `/sign-up/email` — which matters, because OAuth
has no Turnstile challenge in front of it. Matching is on a normalized key
(`src/lib/email-address.ts`): plus-suffixes stripped everywhere, dots stripped
for Gmail, so alias cycling does not defeat a rule. A `domain` entry is the
fastest way to end a flood from a disposable-mail provider.

Both gates fail **open** — a database error allows the signup or sign-in and
logs at error level. They are abuse filters, not authentication; a missing
migration must not take the front door down for everyone.

**"Is this address already blocked?"** is a search box on the blocklist panel,
and it is not a substring match. Paste an address exactly as a signup log
printed it: the server normalizes it first (`buildBlocklistSearch` in
`src/services/moderation.ts`), so a rule stored as `ab@gmail.com` still comes
back when you type `a.b+spam@gmail.com`, and a **domain** rule covering the
address comes back too. A plain substring search would answer "not blocked" in
both cases, which is the one wrong answer that box must never give. An empty
result says so in words rather than showing an empty table.

The suspended-accounts list pages at 50 and takes its count from
`countAdminBannedUsers()` rather than from the rows on screen — a wave that
suspended four hundred accounts used to report fifty.

## Billing Surfaces

Three pages, and the split between them is deliberate.

`/orders` searches `order_no`, `sub_id`, org, user uuid, and email. Its
**Granted** column compares `orders.credits` against the ledger rows carrying
that order number — a paid order promising credits with none granted is the
defect roadmap item 4 was written about, and two rows for one order is the
opposite defect. Order numbers come in three shapes and the page labels them:
`renewal:<sub>:<period>` (derived from the billing period, so a Stripe
redelivery collides instead of billing twice), UUIDv7, and old numeric ids.

`/reconciliation` runs the **local** half of `reconcileLocalBilling()` — the same
findings `pnpm reconcile:stripe --local-only` computes, for people who do not run
CLI commands. It cannot detect "Stripe charged them and we were never told";
that needs the invoice API and stays in the script, and the page says so rather
than implying a green result is the whole check.

`/stripe-events` has exactly one write: **Resolve**. It does not replay.

- **To re-run a parked event**, press Resend in the Stripe dashboard. That
  already works — `action_required` is in `RECLAIMABLE_STATUSES`, so the
  redelivery reclaims the row and processes it against Stripe's current state.
  Every write on that path is keyed on the Stripe object (see
  `src/services/stripe/idempotency.ts`), so a replay cannot double-charge or
  double-credit.
- **Resolve** records that a human dealt with it outside this system, with a
  required note. It is **terminal**: a later redelivery is acknowledged and not
  re-run, because undoing a person's decision with a Resend button is the wrong
  default. `claimStripeWebhookEvent` treats `resolved` like `completed`.

A console button replaying the *stored* payload was considered and left out: it
would run a snapshot of the past through the money path, and needs the webhook's
600-line switch lifted out of its route first. See item 16 in
[roadmap.md](../../roadmap.md).

## Lists and the Overview

Every list pages through `apps/admin/components/pager.tsx`, which takes a
**total** rather than guessing from `rows.length === pageSize`. The guess had two
faults worth not reintroducing: it offers a Next link into an empty page whenever
the total divides evenly by the page size, and it can never say how much is left
— a list that stops at its cap looks complete. The pager reads "Page 3 of 47 ·
2310 rows", so add a count alongside any new list rather than a bare `limit`.

The overview's four tiles are **not** an analytics dashboard, deliberately. Each
is a number that changes what the operator does next: signups in the last 7 days
(where a bot wave first shows up), live subscriptions with past-due called out
(payments to chase), suspended accounts (is moderation keeping up), and parked
Stripe events (these do not retry on their own). Revenue, conversion, and churn
are left to the Stripe dashboard, which renders them better. Credits outstanding
is left out too — it is a finance figure with no action attached, and computing
it honestly needs a global ledger aggregate. A tile nobody acts on teaches people
to stop reading the row.

## Boundary

Admin-specific code should stay in this app:

- Admin RBAC: `apps/admin/lib/authz.ts`
- Admin-only data queries: `apps/admin/lib/data.ts`
- Admin audit trail: `apps/admin/lib/audit.ts`
- Admin origin checks: `apps/admin/lib/origin.ts` (delegates to `src/lib/origin.ts` with the public web origin excluded)
- Admin response headers: `apps/admin/middleware.ts`
- Admin UI: `apps/admin/app/(admin)`
- Admin APIs: `apps/admin/app/api/admin`

Shared auth, database schema, product models, and service integrations stay in `src/`.

## Current Surfaces

- `/` overview with latest users, paid orders, and credit tools.
- `/users`
- `/orders`
- `/feedbacks`
- `/reservations`
- `/affiliates`
- `/organizations`
- `/moderation`
- `/stripe-events`
- `/reconciliation`
- `/audit`
- `/mfa-required`
- `/two-factor`
- `/api/admin/users`
- `/api/admin/orders`
- `/api/admin/users/[uuid]/credits`
- `/api/admin/users/[uuid]/plan`
- `/api/admin/users/[uuid]/ban`
- `/api/admin/blocklist`
- `/api/admin/blocklist/[uuid]`
- `/api/admin/stripe-events/[eventId]/resolve`
- `/api/admin/credits/grant`
- `/api/auth/[...all]`

## Production Notes

- Deploy this app as a separate service or project from the public web app.
- Use a dedicated admin origin, for example `https://admin.example.com`.
- Set `NEXT_PUBLIC_ADMIN_WEB_URL` to that origin.
- Keep `DATABASE_URL`, `BETTER_AUTH_SECRET`, and other shared secrets aligned with the public web app.
- Promote trusted operators with `pnpm admin:promote <email> [admin_ro|admin_rw]`, then have each admin enable two-factor auth before opening the console.
- Keep new admin write actions behind `requireAdminWrite()` and same-origin protection, and record them with `writeAdminAuditLog()`.
- Set `ADMIN_MAX_CREDIT_GRANT` to a sane ceiling for your product (defaults to 100000).
- `apps/admin/middleware.ts` sends `noindex` and `no-store` on every admin response; keep the RBAC gate in the layout and route handlers rather than moving it into middleware.
