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
- [x] `.env.example`, lint gate, deterministic tests, CI workflow, and working Husky hooks
- [x] Account credit grant endpoint is disabled by default unless explicitly enabled for non-production demo use
- [x] Plans & entitlements: free/plus/max tiers, feature gates, usage limits, comped accounts
- [x] Subscription lifecycle: cancel, downgrade, dunning, and out-of-order webhook protection
- [x] Organizations & tenancy: personal workspace per user, org-scoped data, pooled credits — see [docs/organizations.md](docs/organizations.md)
- [x] Teams: invitations with email, member management, roles, last-owner protection
- [x] Billing belongs to the organization: org-scoped Stripe customer, owner-only checkout and portal

---

## Urgent Starter Roadmap

Focus: fix the risky gaps that make the boilerplate safer to clone, configure,
and ship. Do not expand into large product features until these are done.

### Fix Next

Ordered. Take the top item.

1. [ ] [P0] Make a fresh clone run without Docker
   - `pnpm setup` requires Docker + Postgres before anything renders. Every
     other starter kit runs on `create` + `dev` alone.
   - Consider an embedded Postgres (PGlite speaks the wire protocol and Drizzle
     supports it) as the dev default, keeping Docker as the production-shaped
     opt-in.

2. [ ] [P0] Unblock first sign-in without an email provider
   - `requireEmailVerification: true` plus no `RESEND_API_KEY` means signup
     succeeds and sign-in is then impossible. The send throws, the error is
     logged, and the account is stranded.
   - In development, print the verification URL to the console instead of
     failing. Do not weaken the production path.

3. [ ] [P0] Add error tracking and structured production logs
   - Today a production failure leaves pino on stdout and nothing else. The
     tenancy work changed how every query is scoped; the first bug in it will
     arrive as "my files are gone".
   - Smallest useful version: Sentry plus one pass replacing stray
     `console.log` in services with the existing logger.

4. [ ] [P0] Require MFA for admin roles
   - `apps/admin` authenticates against the same user table as customers, so an
     admin account is protected by a password and a captcha, and credential
     stuffing against the *public* login page reaches the admin console.
   - Better Auth ships a `two-factor` plugin. Require it when
     `users.role != 'user'`.

5. [ ] [P1] Promote the first admin without SQL
   - Every user signs up as `role='user'`; the only path to admin is a manual
     `update users set role=...`. Add `pnpm admin:promote <email>`.

6. [ ] [P1] Write the account-deletion policy, then build it
   - There is no deletion or export path at all, and both are legal
     obligations once real users exist.
   - The policy comes first and is a table: for every table, erase /
     anonymize / retain. Financial records (`orders`, `subscriptions`) are
     retained; `credits.user_uuid` is anonymized but the row stays;
     `auth_events` is append-only by design.
   - Tenancy raised the cost: deciding what happens when the sole owner of a
     shared team deletes their account is a product flow, not a query. See
     [docs/organizations.md](docs/organizations.md).

7. [ ] [P1] Harden file uploads
   - Validate file type/size server-side.
   - Keep files private by default.
   - Document the S3/R2/MinIO smoke test.

8. [ ] [P1] Add a small release checklist
   - Manual checks: signup, login, checkout, webhook, credits, reservation,
     upload, localized homepage, invite a teammate.
   - Commands: `pnpm lint`, `pnpm test:run`, `pnpm build`.

---

## Finishing Tenancy

Organizations shipped; these complete the story. None is required for a
single-person deployment, and each is additive — the seams are already in
place. Full reasoning in [docs/organizations.md](docs/organizations.md).

9. [ ] [P1] Org switcher
   - A user can now belong to several organizations and has no way to move
     between them. `getOrgContext` picks active → personal → first.
   - Blocks nothing else, but makes item 10 worth doing.

10. [ ] [P2] Move tenant routes under `/[locale]/[org]/`
    - `getOrgContext(req, orgSlug)` already accepts a slug; nothing passes one.
    - Path scoping beats session-only: with the org held only in the session,
      two browser tabs on two organizations fight over one value and the loser
      silently acts in the wrong tenant.
    - Large: it moves every page and every link. Its own change.

11. [ ] [P2] "Request upgrade" flow
    - A member hitting checkout gets `BILLING_OWNER_ONLY` with a clear message,
      but nothing tells the owner they were asked.

12. [ ] [P2] Dedicated billing role
    - Billing is owner-only. Mature products split it out so finance can hold
      billing without product access. Additive on top of `can()`.

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
