# 🗺️ Roadmap

Legend:

- [P0] must-have / near-term · [P1] high impact · [P2] nice-to-have
- [x] shipped · [ ] planned

---

## ✅ Shipped (baseline)

- Auth (Better Auth): email/password, Google OAuth, RBAC (admin/user)
- I18n (next-intl v4) with locale routing and message catalogs
- Billing v1: Stripe Checkout + Billing Portal
- Orders + Stripe webhook (checkout.session.completed)
- Credits ledger v1 (grant / consume / expiry aware)
- Reservations v1: availability → checkout (deposit/full) → confirmation (ICS + Google link) + admin/user views
- Affiliates v1: invite links, attribution, reward calculation, admin view
- Email (Resend): welcome, payment success/failure, reservation confirmed
- Admin area + role-guarded APIs
- Docs/blog (MDX), Next.js 15, Drizzle migrations, health endpoint
- Password reset: email link flow (completed)
- Feedback v1: in-app modal (i18n), API submission, admin review page
- Starter hardening v1:
  - Account credit grants are disabled by default and require an explicit non-production demo flag.
  - `.env.example` is committed and `.gitignore` keeps real env files out of git.
  - ESLint is configured as a zero-warning local/CI gate.
  - Better Auth secret handling is explicit, with production runtime protection.
  - Vitest runs deterministically with server-only module shims.
  - GitHub Actions CI runs install, lint, tests, and build.
  - Husky hooks are executable and normal commits run the pre-commit build gate.

---

## 🧭 Coming Weeks Roadmap

This is the execution backlog for turning the project from a feature-rich starter into a production-ready SaaS boilerplate. Keep the current working rhythm: fix one issue at a time, verify it, then commit it before moving to the next issue.

### Definition of Done for Each Issue

- Include schema + migration when the data model changes.
- Keep API, service, model, and UI changes scoped to the issue.
- Add or update tests for changed behavior; prefer deterministic mocks for external services.
- Update `.env.example`, docs, and roadmap notes when config or setup changes.
- Run the smallest useful validation, and run `pnpm lint`, `pnpm test:run`, and `pnpm build` for broad behavior changes.
- Document manual checks for auth, billing, storage, reservations, and i18n changes.

### Week 1 — Production Guardrails [P0]

- [ ] Add typed env validation with clear startup errors for required production secrets.
- [ ] Flag or hide internal demo pages and APIs (`credits-test`, mock task/video flows, demo reservation seeding) outside local/demo environments.
- [ ] Add shared rate limiting for auth-adjacent, account, checkout, feedback, upload, and task routes.
- [ ] Add origin/CSRF-style protection for sensitive POST routes that rely on browser cookies.
- [ ] Review security headers and add a starter CSP strategy that works with Stripe, auth, analytics, and docs.
- [ ] Replace remaining ad-hoc `console.log` calls in services/routes with structured logging.

### Week 2 — Auth & Account Hardening [P0]

- [ ] Email verification on signup and email change.
- [ ] Account deletion and data export flow.
- [ ] OAuth provider link/unlink in account settings.
- [ ] Session/device management page with revoke action.
- [ ] Optional 2FA with TOTP, backup codes, recovery flow, and admin-safe reset policy.
- [ ] Account profile completeness pass: name, avatar, locale, timezone, marketing consent.

### Week 3 — Billing & Entitlements [P0]

- [ ] Add first-class subscription/entitlement tables instead of relying only on orders.
- [ ] Expand Stripe webhook handling for subscription created/updated/deleted, invoice paid/failed, customer updated, and checkout completed.
- [ ] Add webhook event idempotency storage and replay-safe processing.
- [ ] Build customer billing page: current plan, renewal date, payment method, invoice history, cancel/reactivate.
- [ ] Support plan upgrades/downgrades with clear proration behavior.
- [ ] Add dunning states and failed-payment email/portal recovery links.

### Week 4 — Organizations & Multi-Tenancy [P0]

- [ ] Add organizations, memberships, invites, and org roles: owner/admin/member.
- [ ] Add org switcher and account/team settings UI.
- [ ] Scope user-owned data by org where appropriate: orders, credits, files, tasks, reservations, and admin views.
- [ ] Sync seat count with subscription billing.
- [ ] Add invite accept/decline/revoke flows with signed tokens.
- [ ] Add tests for cross-org access denial.

### Week 5 — Credits, Usage & Tasks v2 [P0/P1]

- [ ] Add usage events and daily rollups for reporting, quotas, and alerts.
- [ ] Make task credit consumption reservation-based, with refunds on provider failure.
- [ ] Add idempotency keys for credit-consuming task creation.
- [ ] Add low-balance notifications and optional auto top-up.
- [ ] Add prepaid credit packs and expiration reminder emails.
- [ ] Replace mock-first task provider behavior with a clean provider adapter contract and production-ready configuration.

### Week 6 — File Storage & Upload Hardening [P0/P1]

- [ ] Validate upload content type, size, extension, owner, and intended visibility server-side.
- [ ] Add private-by-default signed download flow checks across API and UI.
- [ ] Add CORS setup docs for S3/R2/MinIO and a storage smoke-test checklist.
- [ ] Add image metadata, thumbnails, and cleanup job for abandoned uploads.
- [ ] Add malware scanning hook or documented extension point.
- [ ] Add org/user access tests for file listing, download, delete, and soft-delete behavior.

### Week 7 — Admin, Audit & Observability [P1]

- [ ] Add central audit log table and viewer for admin/user/security actions.
- [ ] Add admin impersonation with explicit audit trail and UI warning state.
- [ ] Add Sentry or equivalent error tracking.
- [ ] Add request correlation IDs and structured logs for route handlers.
- [ ] Add admin alerts for failed charges, task failures, suspicious rate-limit hits, and webhook failures.
- [ ] Add exportable admin reports for users, orders, credits, tasks, reservations, and affiliates.

### Week 8 — Testing, CI & Release Operations [P1]

- [ ] Add Playwright E2E paths: signup, login, checkout, webhook simulation, credits, reservation, upload.
- [ ] Add migration drift checks in CI.
- [ ] Add seed/reset scripts for local demo data.
- [ ] Add Dockerfile and docker-compose for app + Postgres + storage-compatible local dev.
- [ ] Add preview/staging deployment docs.
- [ ] Add backup/restore runbooks and a migration rollback policy.

### Week 9+ — UX, Content, Legal & Growth [P2]

- [ ] Add cookie consent and preference storage.
- [ ] Add production-ready Terms, Privacy, imprint/contact, and data retention docs.
- [ ] Complete accessibility pass: labels, focus, keyboard nav, contrast, and error messaging.
- [ ] Add SEO pass: sitemap, robots, RSS, canonical/hreflang, OG images, per-locale metadata.
- [ ] Add analytics dashboards for MRR, churn, revenue, signups, usage, reservations, and referrals.
- [ ] Add support/help-center flows: FAQ search, ticket/contact integration, and optional chat provider.

### Priority Backlog Summary

- [P0] Production guardrails: typed env validation, demo gating, rate limiting, origin protection, auth verification, billing entitlements, webhook idempotency, organizations, credit/task idempotency.
- [P1] Operational depth: storage hardening, audit logs, observability, admin safety, E2E coverage, migration checks, deployment docs.
- [P2] Product polish: legal/consent, SEO, accessibility, analytics dashboards, support integrations, marketplace/catalog expansions.

---

## 🧩 Category A — Market Features (subscriptions, reservations, usage, etc.)

### A1. Subscriptions & Plans v2 — Stripe [P0]

- Define plan catalog (monthly/yearly) with explicit Stripe Price IDs
- Upgrade/downgrade with proration (+ immediate vs. next-cycle switches)
- Seat-based billing: sync seat count with org/team members
- Free trials; coupons & promotions
- Customer billing page: manage plan, payment method, invoice history
- Taxes (Stripe Tax), tax ID capture & invoice localization
- Dunning flow (failed payment emails + portal link)

### A2. Credits/Usage v2 — Quotas & Metering [P0]

- Usage events table + daily rollups (for reporting/alerts)
- Low-balance alerts; optional auto top-up on threshold
- Prepaid bundles/packs + coupon support
- Credit expiry policies & reminder emails
- Hybrid billing: subscription includes monthly credits + overage via top-ups

### A3. Reservations v2 — Scheduling at Scale [P1]

- Staff/resources & capacity (assign bookings; conflict detection)
- Two-way calendar sync (Google/Outlook); ICS remains fallback
- Cancellation/reschedule policies, fees & refund handling
- Email/SMS reminders, no-show rules, waitlist
- Business hours UI, timezone handling, blackout dates/holidays

### A4. Digital Products & Downloads [P1]

- Secure delivery via signed URLs (private bucket)
- Optional license keys + validation endpoint
- Versioned releases, changelog, download limits & audit trail

### A5. Promotions, Loyalty & Referrals 2.0 [P2]

- Discount coupons (percent/fixed), min spend & usage caps
- Gift cards / store credit
- Referrals: UTM capture, multi-touch attribution, payout export (CSV)

### A6. Analytics & Revenue Reporting [P1]

- Charts: MRR, revenue, signups, churn, ARPU/LTV
- Reservations utilization by service/staff/time
- Referral performance and CAC proxy
- Export CSV for Orders/Usage/Customers

### A7. Customer Support Integrations [P2]

- In-app help center (FAQ/Docs search)
- Optional chat widget (Intercom/Chatwoot)
- Support inbox integration (forwarding/ticketing)

### A8. Marketplace/Service Catalog (Optional) [P2]

- Public catalog with search, categories, filters
- Reviews/ratings (moderation), vendor pages
- Vendor onboarding (if multi-vendor future)

---

## 🧱 Category B — Core Platform & General Functionality

### B1. Authentication & Account Hardening [P0]

- [x] Password reset flow (email link + token, rate-limited)
- [ ] Email verification (on signup & on email change)
- [ ] 2FA (TOTP) with backup codes; recovery flow
- [ ] Passkeys/WebAuthn (passwordless) – optional
- [ ] Account deletion & data export (GDPR)
- [ ] OAuth provider link/unlink in account settings

### B2. Organizations/Teams (Multi-Tenancy) [P0]

- organizations, memberships schema; roles: owner/admin/member
- Invite by email (signed token); accept/decline + re-invite
- Data scoping by org across models (RLS-style guards in queries)
- Seat counts synced to subscription; org switcher in UI

### B3. File Uploads & Storage [P0]

- Upload service (S3/UploadThing) for images/files
- Public vs private buckets; signed downloads
- Next/Image pipeline (thumbs), metadata (size, mime, owner)
- Attachments for reservations/orders/email templates

### B4. Notifications & Preferences [P1]

- In-app notification center (unread counts, mark-as-read)
- Preferences per channel/event (email/SMS/in-app)
- SMS provider wiring (Twilio/MessageBird) for reminders/2FA
- Slack webhook for admin alerts (new order, failed charge)

### B5. Billing Enhancements (Core) [P1]

- Customer billing profile: manage payment methods, invoices, receipts
- Admin: one-off invoices/adjustments, manual credit grants (noted)
- Refunds / partial refunds with audit trail
- Multi-currency support & currency display by locale

### B6. Admin, Audit & Observability [P1]

- User impersonation (admin-only) with full audit log
- Central audit log (who/what/when/IP) viewer & export
- API rate limiting + abuse detection
- Error tracking (Sentry) + app activity logs
- Product analytics wiring (PostHog/GA)

### B7. Public API & Webhooks [P1]

- Public REST API (JWT/API key) for core operations
- OpenAPI spec + interactive docs page
- Outgoing webhooks (user-configurable per event)
- Incoming webhooks example (Zapier/Make recipes)

### B8. Content & SEO [P2]

- sitemap.xml, robots.txt, RSS for blog/docs
- Per-page OG image generation
- MDX authoring components (callouts, tabs, code copy)
- Multi-locale SEO meta (alts/canonicals)

### B9. UI/UX & Accessibility [P2]

- Dark mode toggle (persisted)
- Form validation with Zod + friendly errors
- Standardized components (e.g., shadcn/ui) for consistency
- A11y pass (labels, focus, keyboard, contrast)

### B10. Testing & Developer Experience [P2]

- Unit tests (Vitest) for services: credits, affiliates, reservations
- E2E (Playwright): auth → checkout → webhook → credit/reservation
- Email snapshot tests; seed scripts for demo data
- CI (GitHub Actions): typecheck, tests, lint, migrations on PRs

### B11. Deployment & Ops [P2]

- Dockerfile + docker-compose for local dev & CI
- Staging environment, preview deploys, feature flags per env
- Caching/ISR where applicable; edge/runtime tuning
- DB backups & restore scripts; migration safety checks

### B12. Legal & Consent [P2]

- Cookie consent banner + preferences storage
- Terms/Privacy templates; imprint/contact pages
- Consent logs & marketing opt-in tracking
- Data retention windows (soft delete, purge jobs)

---

## 🧭 Suggested Milestones (optional)

- Now (P0): B1, B2, B3, A1, A2
- Next (P1): A3, A6, B4, B5, B6, B7
- Later (P2): A4, A5, A7, A8, B8–B12

---

## ✍️ Notes for Contributors

- Each unchecked item should include: schema changes (if any), API routes, UI, tests, docs.
- Keep features modular & togglable (feature flags), mirroring the Reservations module.
- Prefer type-safe boundaries (Drizzle types + Zod validation) and audited side-effects (emails, webhooks, billing).
