# Roadmap

Legend:

- [P0] urgent starter readiness
- [P1] important, but after P0
- [P2] later / optional
- [x] shipped
- [ ] planned

---

## Shipped Baseline

- [x] Auth: email/password, Google OAuth, RBAC (admin/user)
- [x] I18n with locale routing and message catalogs
- [x] Billing v1: Stripe Checkout + Billing Portal
- [x] Orders + Stripe webhook for `checkout.session.completed`
- [x] Credits ledger v1: grant / consume / expiry aware
- [x] Reservations v1: availability, checkout, confirmation, admin/user views
- [x] Affiliates v1: invite links, attribution, rewards, admin view
- [x] Email via Resend: welcome, payment success/failure, reservation confirmed
- [x] Admin app boundary: admin UI and admin APIs run from `apps/admin`, separate from public web routes
- [x] Docs/blog with MDX, Drizzle migrations, health endpoint
- [x] Password reset email link flow
- [x] Feedback modal, API submission, admin review page
- [x] Storage v1: private S3/R2/MinIO-compatible uploads, presigned download
  URLs, org-scoped file reads, soft delete
- [x] Tasks scaffold: generic task records, text-to-video demo provider,
  idempotency, credit spend/refund tracing, monthly plan limits
- [x] Durable background jobs: database queue, Vercel cron drain, retries,
  dedupe keys, pruning for finished jobs
- [x] Auth hardening: Cloudflare Turnstile wiring, auth event logs, local
  development verification/password-reset link logging
- [x] `.env.example`, lint gate, deterministic tests, CI workflow, and working Husky hooks
- [x] Account credit grant endpoint is disabled by default unless explicitly enabled for non-production demo use
- [x] Plans & entitlements: free/plus/max tiers, feature gates, usage limits, comped accounts
- [x] Subscription lifecycle: cancel, downgrade, dunning, and out-of-order webhook protection
- [x] Organizations & tenancy: personal workspace per user, org-scoped data, pooled credits — see [docs/organizations.md](docs/organizations.md)
- [x] Teams: invitations with email, member management, roles, last-owner protection
- [x] Billing belongs to the organization: org-scoped Stripe customer, owner-only checkout and portal
- [x] Site/app split: `NEXT_PUBLIC_SITE_MODE=site` serves landing, docs, blog,
  and health only, while SaaS routes are blocked at middleware

---

## Urgent Starter Roadmap

Focus: fix the risky gaps that make the boilerplate safer to clone, configure,
and ship. Do not expand into large product features until these are done.

### Fix Next

Ordered by what hurts a real deployment first, not by when it was found. Take
the top item.

The reordering came out of a full audit against the code on 2026-07-26. Two
things changed. Items 2, 3, and 4 were missing from this roadmap entirely and
each one blocks going live. "Make a fresh clone run without Docker" dropped
from the top to item 7, because it is a template *adoption* problem — it slows
strangers cloning the public repo, and blocks nothing for anyone who already
has Docker running.

Items 1, 2, and 3 shipped on 2026-07-26 and are kept in place, with what was
deliberately left open recorded under each. Rate limiting was demoted from P0
to item 5 the same day, and account deletion to item 6 — the reasoning is
recorded on each, because a priority that moves without a reason moves back.
Account deletion carries a **trigger rather than a position**: it must happen
before the first real user, whenever that lands. **Item 4 is the top of the
queue.**

1. [x] [P0] Route every production failure through the logger
   - Swept all 20 stray `console.*` calls in server code onto `src/lib/logger`,
     with structured context fields at each site. They previously carried no
     request id, no level control, and — the actual defect — **no redaction**.
   - Highest-value sites: the Stripe webhook's catch-all now names the event it
     died on (`stripe_event_id` is hoisted so a 500 can be found and replayed
     in the Stripe dashboard), and `src/services/credit.ts` reports every
     grant, consume, and refund failure with the org, user, and transaction.
   - `auth.ts` no longer interpolates a user's email address into a password
     reset log line. An interpolated address cannot be redacted; it is now a
     `user_id` field.
   - `tests/unit/architecture.test.ts` fails the build on a new `console.*` in
     server code. Client components are exempt — the logger is `server-only`
     and a browser error belongs in the browser console.
   - Still open, deliberately: **where the logs go**. Structured JSON on stdout
     is only worth writing if something ingests it, and Vercel's runtime logs
     age out. A log drain is the cheap default; Sentry buys client-side React
     errors, source-mapped stack traces, and grouping on top of that; neither
     is mandatory. Decide it, rather than defaulting into it.
   - Not covered by any of this: wrong-tenant queries return the wrong rows
     *successfully*, so nothing throws and no error tracker sees them. That
     risk is owned by `tests/unit/architecture.test.ts` and the db-tier tests.
   - Also already covered: failed Stripe webhook deliveries are visible in the
     Stripe dashboard, retried automatically, and mailed out after repeated
     failures.

2. [x] [P0] Publish legal pages and gate analytics on consent
   - Added `/[locale]/privacy` and `/[locale]/terms`, rendered from
     `src/config/legal.ts` — a drafting skeleton, explicitly not legal advice.
     Both pages show a non-dismissible unreviewed-draft notice until the
     operator fills in the entity fields, and both are reachable in `site` mode
     because that is where a payment processor reads them.
   - Added a consent gate. `GoogleAnalytics` and `Adsense` now call
     `useConsent()` and render nothing until the visitor opts in — the tag is
     gated, not a flag inside it, because a loaded tag has already set cookies
     and already contacted the vendor.
   - Deny by default: an absent, malformed, or version-stale cookie parses to
     `null`, and `null` is a refusal. Covered by `tests/unit/consent.test.ts`.
   - Reject is one click at the same visual weight as accept, and the footer's
     cookie settings control reopens the banner so consent can be withdrawn as
     easily as it was given.
   - No banner at all when neither vendor is configured — a fresh clone has
     nothing to consent to.
   - `tests/unit/architecture.test.ts` fails the build if any file references a
     known tracker host without gating on `useConsent()`.
   - Operator steps in [docs/legal.md](docs/legal.md); launch gates added to
     [docs/release-checklist.md](docs/release-checklist.md).
   - **Not done, and required before launch:** filling in the entity details
     and a lawyer's review of both documents.

3. [x] [P0] Add security headers
   - Both apps now apply a shared baseline from
     `src/config/security-headers.js` through `headers()`:
     `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
     `Permissions-Policy`, production-only HSTS, and a CSP.
   - The CSP ships **report-only**. An enforced policy that is wrong breaks the
     site only in production, and this kit cannot know which storage host or
     image CDN a deployment adds. `CSP_MODE=enforce` flips it once the reports
     are quiet; the procedure is in
     [docs/security-headers.md](docs/security-headers.md).
   - Vendor hosts are conditional on their env vars, so `apps/admin` — which
     runs neither analytics nor ads — gets the tightest policy for free.
   - `'unsafe-eval'` and the HMR websocket are development-only. Still loose:
     `script-src`/`style-src` keep `'unsafe-inline'`, because removing it needs
     a nonce threaded from middleware through the document. Its own change.
   - Audit correction: the original finding said the repo had no security
     headers. That was true of the public app but wrong as a blanket claim —
     `apps/admin/middleware.ts` already set a narrow **enforced** CSP plus
     `X-Robots-Tag` and `no-store`. Those stay; both layers are documented in
     that file and in the doc above.

4. [ ] [P1] Remove serverless collision risk from generated ids
   - Promoted out of technical debt: it is a deployment-shape bug, not
     housekeeping. `getSnowId()` in `src/lib/hash.ts` defaults to one worker id,
     and serverless runs many instances of it at once.
   - Unique indexes protect data integrity, but a collision still becomes a
     user-visible failed insert on a financial record. Prefer UUIDv7 or another
     instance-safe id for new financial and usage records.

5. [ ] [P1] Make rate limiting fail loudly instead of degrading quietly
   - `src/lib/rate-limit.ts` already supports a Redis REST store, but falls
     back to an in-process `Map` unless `RATE_LIMIT_REDIS_REST_URL` and
     `RATE_LIMIT_REDIS_REST_TOKEN` are set. On serverless each instance keeps
     its own counter, so a published limit of 20/min is really 20 × warm
     instances.
   - Demoted from P0 on 2026-07-26. The original argument was that this leaves
     the login endpoint open to credential stuffing, and that was overstated:
     Turnstile already guards `/sign-in/email`, `/sign-up/email`, and the
     mail-sending endpoints, and its key is mandatory in production. What is
     actually left soft is the *authenticated* endpoints — checkout, uploads,
     tasks — where an attacker needs an account first. That is abuse-cost
     control, not account takeover.
   - The operational half is already handled: setting the Redis pair is a gate
     in [docs/release-checklist.md](docs/release-checklist.md). What remains is
     the code half — require the pair in production env validation so a
     misconfigured deployment fails at boot rather than silently serving
     advisory limits.

6. [ ] [P1] Write the account-deletion policy, then build it
   - **Trigger, not a date: do this before your first real user.** Deletion and
     export are legal obligations from the moment you hold someone else's
     personal data, and the privacy policy shipped in item 2 already makes
     retention promises that nothing implements yet. Deferred on 2026-07-26
     because the product is pre-launch and has no such users.
   - The policy comes first and is a table: for every table, erase /
     anonymize / retain. Financial records (`orders`, `subscriptions`) are
     retained; `credits.user_uuid` is anonymized but the row stays;
     `auth_events` is append-only by design.
   - Tenancy raised the cost: deciding what happens when the sole owner of a
     shared team deletes their account is a product flow, not a query. That
     decision is the blocker on starting, not the implementation. See
     [docs/organizations.md](docs/organizations.md).

7. [ ] [P1] Make a fresh clone run without Docker
   - `pnpm setup` requires Docker + Postgres before anything renders. Every
     other starter kit runs on `create` + `dev` alone.
   - Consider an embedded Postgres (PGlite speaks the wire protocol and Drizzle
     supports it) as the dev default, keeping Docker as the production-shaped
     opt-in.
   - Real value is adoption of the public template. It blocks no deployment.

### Already Fixed

Kept for the reasoning, not the status.

- [x] [P0] Unblock first sign-in without an email provider
  - Development and test builds now detect a missing email provider and log
    verification/password-reset links through the app logger instead of
    stranding the account.
  - Production still requires a real provider and preserves the fail-closed
    path.

- [x] [P0] Require MFA for admin roles
  - Better Auth two-factor auth is wired into the public app and admin app.
    Users can enable/disable authenticator-app MFA from their account page,
    with backup codes shown during setup.
  - `apps/admin` now blocks `admin_ro` and `admin_rw` users until
    `users.two_factor_enabled` is true, and sends them to a setup-required
    page instead of the admin console.

- [x] [P1] Promote the first admin without SQL
  - Added `pnpm admin:promote <email> [admin_ro|admin_rw]`, backed by
    `scripts/admin-promote.mjs`.
  - The command refuses ambiguous same-email multi-provider matches unless the
    operator passes `--provider <provider>`, and reminds admins to enable MFA.

- [x] [P1] Finish hardening file uploads
  - Already shipped: files are private by default, tenant-scoped, size-limited
    by both deployment env and plan limits, completed through presigned URLs,
    and soft-deleted.
  - Added named upload policies in `src/config/storage.ts`, enforced
    server-side and shared with a reusable configurable `Uploader` component.
  - Added optional and policy-required SHA-256 checksums, completion-time
    checksum mismatch handling, and stale `uploading` row cleanup.
  - Added provider-neutral R2/AWS S3/MinIO setup and smoke-test docs in
    [docs/storage-providers.md](docs/storage-providers.md).

- [x] [P1] Add a small release checklist
  - Added [docs/release-checklist.md](docs/release-checklist.md) with required
    commands, core manual smoke checks, conditional checks, and PR validation
    notes.
  - Linked it from [DEPLOYMENT.md](DEPLOYMENT.md) and the README documentation
    map.

- [x] [P1] Reconcile docs and product copy with the current code
  - Updated `docs/database.md` so `files.org_uuid` is documented as the tenant
    column and `files.org_id` as legacy cleanup, not future tenancy.
  - Removed the pricing promise for a usage analytics dashboard while that
    dashboard remains P2.
  - Aligned visible pricing names with free/plus/max entitlements while keeping
    compatibility-sensitive product ids and Stripe env fallbacks in place.

---

## Finishing Tenancy

Organizations shipped; these complete the story. None is required for a
single-person deployment, and each is additive — the seams are already in
place. Full reasoning in [docs/organizations.md](docs/organizations.md).

8. [ ] [P1] Org switcher
   - A user can now belong to several organizations and has no way to move
     between them. `getOrgContext` picks active → personal → first.
   - Blocks nothing else, but makes item 9 worth doing.
   - Audit note: this is P1 only for a B2B product. If the product built on
     this template is B2C or single-workspace, it can wait indefinitely.

9. [ ] [P2] Move tenant routes under `/[locale]/[org]/`
    - `getOrgContext(req, orgSlug)` already accepts a slug; nothing passes one.
    - Path scoping beats session-only: with the org held only in the session,
      two browser tabs on two organizations fight over one value and the loser
      silently acts in the wrong tenant.
    - Large: it moves every page and every link. Its own change.

10. [ ] [P2] "Request upgrade" flow
    - A member hitting checkout gets `BILLING_OWNER_ONLY` with a clear message,
      but nothing tells the owner they were asked.

11. [ ] [P2] Dedicated billing role
    - Billing is owner-only. Mature products split it out so finance can hold
      billing without product access. Additive on top of `can()`.

---

## Technical Debt Worth Scheduling

These are not product features, but they are unfinished pieces of starter
readiness that came out of the code audit. Treat them as small, isolated
hardening passes rather than one giant schema rewrite.

- [P1] Add foreign keys in expand/contract passes
  - There are no foreign keys anywhere. Start with high-value references such
    as `credits.user_uuid`, `tasks.user_uuid`, and tenant `org_uuid` columns,
    after sweeping orphans.
- [P1] Normalize nullable timestamps on older tables
  - Newer tables use `not null default now()`. Older ones (`orders`, `credits`,
    `posts`, `affiliates`, `feedbacks`, `apikeys`) still rely on application
    code to set `created_at`, which makes a forgotten field break ordering.
- [P1] Define retention for append-only operational tables
  - `jobs` prunes finished rows after 14 days. `auth_events` and
    `admin_audit_logs` currently grow forever; decide retention before the
    tables are large.
- [P1] Delete or commit to the stub tables
  - `posts` and `apikeys` have schema and no code behind them. A stub table is
    a standing invitation to write against it by accident. `apikeys` is already
    listed under "Later, Not Urgent"; `posts` is a leftover from the pre-MDX
    blog.
- [P2] Add database CHECK constraints for status columns
  - Allowed statuses live in comments and TypeScript today. Constraints would
    make accidental direct SQL updates fail loudly.

---

## Later, Not Urgent

Keep these out of the immediate queue unless a real product needs them:

- [P2] Public API keys and outgoing webhooks — the `apikeys` table is a stub
  with no auth middleware; either build it or delete the table
- [P2] Onboarding flow and email notification preferences (an unsubscribe path
  becomes mandatory the day you send your first non-transactional email)
- [P2] Passkeys, session/device management
- [P2] Seat-based billing (wrong model for a credits product — usage pools at
  the org and seats are billed separately, if at all)
- [P2] Teams within an organization, custom roles (both are Better Auth plugin
  flags, deliberately off)
- [P2] Full analytics dashboard
- [P2] Marketplace, reviews, loyalty, referrals 2.0
- [P2] SMS reminders, notification center, support chat
- [P2] Docker, backup/restore scripts, advanced observability
- [P2] Headless CMS for the blog — content is MDX in git on purpose: version
  control, PR review, no sanitization surface. Revisit only when a
  non-technical author needs to publish without a deploy. The unused `posts`
  table is a leftover; delete it or commit to it.

---

## Deploying the tenancy migrations

Migrations `0011`–`0016` introduce organizations. Two need attention on a
database that already holds real rows:

- **`0015` makes `org_uuid` NOT NULL and fails deliberately** if any rows are
  still unscoped. Those are rows whose owner no longer exists, which `0014`
  leaves alone rather than filing under a guessed tenant. The migration reports
  each table and row count so you can decide whether to delete or reassign them.
  On a fresh database it is a no-op.
- **`0016` must run before anyone opens the billing portal.** It moves existing
  Stripe customers onto their personal orgs. Without it, the next portal visit
  mints a *second* Stripe customer and strands the first one's card, invoices,
  and subscription.

Migration `0017` adds admin MFA support:

- **`0017` adds `users.two_factor_enabled` and the Better Auth `two_factor`
  table.** Run it before enforcing admin access on a deployed database. Existing
  admin users will be redirected to the MFA setup-required page until they
  enable two-factor auth from the public account page.

---

## Working Rule

Pick one item from `Fix Next`, fix it, verify it, commit it, then move to the
next. Keep each change small enough that a new user can understand why it
exists.

Two things that are not optional in this repo:

- **Every change ships with tests at the right tier.** See
  [tests/README.md](tests/README.md). Anything the database enforces — a unique
  index, a lock, a constraint — belongs in the database tier, against real
  Postgres. A mock asserts what we *believe* the schema does.
- **Architecture rules are executable.** `tests/unit/architecture.test.ts` fails
  the build on layering violations, unscoped tenant queries, and raw error
  messages reaching the UI. If a rule needs an exception, add it to the
  allowlist *with a reason* rather than deleting the rule.
