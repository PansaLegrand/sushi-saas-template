# Release Checklist

Use this before opening a PR, promoting a deployment, or tagging a release.
Keep the notes short, but record what ran, what was skipped, and why.

## Required Commands

Run these from the repository root:

```bash
pnpm lint
pnpm test:run
pnpm build
```

If the change touches `src/db/schema.ts`, migrations, or database-owned
invariants, also run:

```bash
pnpm db:generate
pnpm db:migrate
pnpm test:db
```

Before applying production migrations, run:

```bash
pnpm db:check:prod
```

## Manual Smoke Checks

- Sign up a new user and verify the account.
- Log out, then log back in.
- Open one localized homepage other than the default locale.
- Start checkout from pricing, complete payment, and confirm the Stripe webhook
  updates the order/subscription state.
- Confirm credits changed through the expected path: checkout, admin grant, or
  a task spend, depending on the change.
- Create a reservation, complete checkout, and confirm it appears in the user's
  reservations page.
- Upload a file, complete the upload, download it, then delete it.
- Invite a teammate, accept the invitation as that user, and confirm the team
  page shows the new member.

## Conditional Checks

- Admin changes: sign in to `apps/admin`, complete MFA if required, and verify
  read/write guards on the affected admin surface.
- Billing changes: open the billing portal, cancel or update a subscription in
  Stripe test mode, and verify the webhook result.
- Billing changes: run the reconciliation check against the target database and
  confirm it exits zero.

  ```bash
  pnpm reconcile:stripe --days 30
  ```

  It compares Stripe against this database — a paid order with no ledger row, a
  running balance that disagrees with the ledger, a paid invoice no event was ever
  recorded for. Errors exit 1; warnings (an event already parked for a human) exit
  0 on purpose, so the check never blocks a release on someone else's queue. With
  no `STRIPE_PRIVATE_KEY` it runs local checks only and says so.
- Confirm `STRIPE_WEBHOOK_SECRET` in production is the **live-mode** endpoint's
  signing secret, not the test-mode one. The webhook rejects any non-live event
  with a 400 in production, so a test-mode secret makes every delivery fail
  visibly on the endpoint in the Stripe dashboard rather than crediting accounts
  from fixture amounts.
- Email changes: confirm the email in the provider dashboard or development
  auth-link logs, and verify no raw provider error reaches the UI.
- Storage changes: run the provider smoke test in
  [docs/storage-providers.md](storage-providers.md) against the target provider
  and verify objects remain private except through signed URLs. Confirm a
  disallowed file type is rejected before a presigned URL is created.
- Site-mode changes: run or build with `NEXT_PUBLIC_SITE_MODE=site` and verify
  only landing, `/docs`, `/blogs`, `/privacy`, `/terms`, and `/api/health` are
  reachable.
- Consent changes: with an analytics or ad id configured, confirm no vendor
  script is in the DOM before a choice is made, that "reject" leaves it absent,
  and that the footer's cookie settings control reopens the banner. See
  [docs/legal.md](legal.md).

## First Production Launch

One-time gates, not per-release. Each one blocks going live rather than blocking
a deploy.

- [ ] `src/config/legal.ts` filled in, so no page renders the unreviewed-draft
      notice, and both documents reviewed by a lawyer. See
      [docs/legal.md](legal.md).
- [ ] Privacy policy retention section reconciled with what deletion actually
      does.
- [ ] `RATE_LIMIT_REDIS_REST_URL` and `RATE_LIMIT_REDIS_REST_TOKEN` set. Without
      them each serverless instance keeps a private counter and the published
      limits are advisory — including on the auth endpoint.
- [ ] Production log destination decided: a drain, an error tracker, or a
      deliberate "stdout is enough for now".
- [ ] Point-in-time restore confirmed available, and the restore procedure run
      once against a scratch database.

## PR Notes

Include a short validation block in the PR:

```text
Validation:
- pnpm lint
- pnpm test:run
- pnpm build
- Manual: signup, login, checkout/webhook, credits, reservation, upload, team invite
```

If a check is skipped, name the reason rather than leaving it implied.
