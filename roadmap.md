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
