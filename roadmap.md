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

---

## Urgent Starter Roadmap

Focus: fix the risky gaps that make the boilerplate safer to clone, configure, and ship. Do not expand into large product features until these are done.

### Fix Next

1. [x] [P0] Hide demo/test surfaces in production
   - Gate or remove `/credits-test`, mock task/video behavior, demo reservation seeding, and other internal playground flows.

2. [x] [P0] Add typed environment validation
   - Fail clearly when required production secrets are missing.
   - Keep `.env.example` synced with the validation rules.

3. [x] [P0] Add basic API rate limiting
   - Cover auth-adjacent routes, checkout, feedback, credits, uploads, and task creation.

4. [x] [P0] Add origin protection for sensitive POST routes
   - Protect cookie-authenticated mutations from cross-site form/script abuse.

5. [x] [P0] Make Stripe webhook processing idempotent
   - Store processed Stripe event IDs.
   - Avoid duplicate orders, duplicate credits, and repeated side effects.

6. [x] [P0] Improve credit/task failure safety
   - Use idempotency keys for credit-consuming task creation.
   - Refund or restore credits when the task provider fails.

7. [ ] [P1] Add email verification
   - Verify new signups and email changes before treating the account as fully trusted.

8. [ ] [P1] Harden file uploads
   - Validate file type/size server-side.
   - Keep files private by default.
   - Document the S3/R2/MinIO smoke test.

9. [ ] [P1] Replace stray service `console.log` calls
   - Use the existing logger path so production logs are easier to search.

10. [ ] [P1] Add a small release checklist
    - Manual checks: signup, login, checkout, webhook, credits, reservation, upload, localized homepage.
    - Commands: `pnpm lint`, `pnpm test:run`, `pnpm build`.

---

## Later, Not Urgent

Keep these out of the immediate queue unless a real product needs them:

- [P2] Organizations / teams / seat billing
- [P2] 2FA, passkeys, session/device management
- [P2] Full analytics dashboard
- [P2] Public API and outgoing webhooks
- [P2] Marketplace, reviews, loyalty, referrals 2.0
- [P2] SMS reminders, notification center, support chat
- [P2] Docker, backup/restore scripts, advanced observability

---

## Working Rule

Pick one item from `Fix Next`, fix it, verify it, commit it, then move to the next. Keep each change small enough that a new user can understand why it exists.
