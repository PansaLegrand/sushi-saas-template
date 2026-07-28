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
things changed. The legal pages, security headers, and generated-id items were
missing from this roadmap entirely and each one blocks going live. "Make a
fresh clone run without Docker" dropped from the top to the bottom of the
queue, because it is a template *adoption* problem — it slows strangers cloning
the public repo, and blocks nothing for anyone who already has Docker running.

The logger, legal pages, and security headers shipped on 2026-07-26 and are
kept in place, with what was deliberately left open recorded under each. Rate
limiting was demoted from P0 the same day, and account deletion after it — the
reasoning is recorded on each, because a priority that moves without a reason
moves back. Account deletion carries a **trigger rather than a position**: it
must happen before the first real user, whenever that lands.

Items 4 and 5 were added on 2026-07-26 after reviewing this template's Stripe
code against `dojo-video-web`, a deployed SaaS that bills through Stripe.
Everything below them shifted down by two. Item 4 went straight to the top of
the queue ahead of the generated-id work: it is the only open item that can
take a customer's money and grant them nothing, and it does so silently.
References between items are by name rather than by number from here on,
because positional references in this file have already gone stale twice.

Items 4, 5, and 6 all shipped. **Item 7 is the top of the queue** — rate limiting
failing loudly instead of degrading quietly.

Item 5 was finished on 2026-07-28, all five steps plus its open refund decision.
It went out of order on purpose: step 5 first because it touches no schema, then
the decision, then 1 → 4. Two things worth carrying forward rather than leaving
buried in the step notes:

- **Reading for step 3 found a live defect of the same class item 4 fixed.** An
  unmapped price recorded a *paid order granting zero credits* — `plan` was
  resolved and never checked, so `credits` fell through to `?? 0`. Item 4 looked at
  the transaction boundary; nobody had looked at what happens when the catalog
  lookup misses. Worth assuming there are more of these than the two found so far.
- **`pnpm reconcile:stripe` now exists to answer the question directly** rather
  than by reading code. It is in the release checklist, and its `--local-only`
  mode needs no Stripe key.

Item 6 then made it three: reading it turned up a *guessable* affiliate invite
code, not just a collision-prone one. **Three of the last three items found a
second defect adjacent to the one they were scoped to fix.** That is now the
expectation rather than a surprise — budget for it, and read the neighbours of
whatever the item names.

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

4. [x] [P0] Make paying and crediting succeed or fail together
   - Shipped 2026-07-26. Both fulfillment paths now write the payment and its
     credits in one transaction, keyed so a replay collides instead of
     duplicating. 12 database-tier tests in
     `tests/db/stripe.fulfillment.test.ts`, including the exact starting state
     the bug produced: an order that says `paid` with no ledger row.
   - **Two mechanisms, because neither covers the other.** The transaction
     removes the window in which a paid order has no credits. A deterministic
     `trans_no` under the existing unique index on `credits.trans_no` is what
     stops two *concurrent* deliveries from each granting — a transaction does
     not help there, since both open their own. Keys are built in
     `src/services/stripe/idempotency.ts`: `order_pay:<order_no>`,
     `stripe_period:<sub_id>:<period_start>`, `renewal:<sub_id>:<period_start>`.
   - The transaction lives in the **model layer**
     (`src/models/fulfillment.ts`), not in the service that used to sequence the
     writes. `tests/unit/architecture.test.ts` allows `db()` only from
     `src/models/`, and `insertSpendCreditIfSufficient` had already set the
     precedent for a compound atomic write there. Stripe's API calls stay
     outside it: a transaction holds one of ten pooled connections and must not
     wait on someone else's network.
   - Both check-then-skip guards are gone rather than corrected. The renewal
     `order_no` is derived from the billing period, so `insertOrder` is
     idempotent under an index that already existed — no migration. Guarding by
     construction beats guarding by inspection; there is no branch left to get
     wrong.
   - `updateCreditForOrder` is deleted. It held the *correct* version of the
     guard, was never called by anything, and sat next to a live incorrect one.
     A pointer to its replacement is left in `src/services/credit.ts`.
   - Fell out of the work: the renewal order payload no longer needs its
     `as any`, so the whole object is type-checked — which is what surfaced that
     `orders.user_uuid` defaults to `""` while `credits.user_uuid` is `not null`.
     `insertRenewalOrderWithGrant` now demands the attribution explicitly rather
     than silently writing a ledger row nobody can trace.
   - Visible change, admin-only: renewal order numbers now read
     `renewal:sub_123:1767225600` instead of a snowflake, in the admin orders
     table. Nothing parses `order_no` numerically — checked — and no
     customer-facing surface renders it.
   - Still open, deliberately: **the same shape survives in affiliate rewards.**
     `updateAffiliateForOrder` guards on `findAffiliateByOrderNo` with no unique
     index behind it, so two concurrent deliveries can both write a reward. Left
     alone here because it is not money the customer handed over and because
     fixing it needs a migration. Now tracked under *Technical Debt Worth
     Scheduling* rather than only in this bullet — a sub-bullet on a shipped
     item is where a known defect goes to be forgotten.
   - Also left in place: `findCreditByOrderNo` in `src/models/credit.ts` is now
     unused. Kept on purpose, unlike the function above — it is a plain query
     accessor rather than a competing copy of a rule, and item 5's
     reconciliation script needs exactly that lookup.
   - Original finding, kept for the reasoning:
     **This was the one open item that could take money and grant nothing.**
     `src/services/stripe/checkout-session.ts` returns early when the order is
     already `paid`, but it writes that status *before* it grants credits. A
     crash, timeout, or deploy in the window between those two writes ends with
     a paid order and no credits — and the next delivery makes it permanent:
     Stripe redelivers, `claimStripeWebhookEvent` re-claims the event because a
     `failed` row is retriable, the handler sees `paid`, returns, and the event
     is marked `completed`. No alert, no retries left, no trace except a
     customer email.
   - The renewal path in `src/app/api/pay/webhook/stripe/route.ts` has the same
     shape: the guard asks whether an order exists for `(sub_id, periodStart)`,
     and the order is inserted before the grant. Crash between them and the
     renewal is never credited.
   - The defect in both is the same: **the guard checks the wrong evidence.** It
     asks whether the payment was recorded, then skips work that is not the
     payment. Fix by guarding the grant on the grant's own evidence — a credit
     row — or by putting both writes in one transaction.
   - `updateCreditForOrder` in `src/services/credit.ts` already performs exactly
     the right check and is **dead code** — nothing in `src` or `tests` calls
     it. Adopt it or delete it. Leaving a correct and an incorrect version of
     the same guard side by side is how this recurs.
   - Then make the grants deterministic: `order_pay:<order_no>` and
     `stripe_period:<sub_id>:<period_start>` as `trans_no`. `credits.trans_no`
     is already unique and `increaseCredits` already accepts an explicit
     `trans_no`; no Stripe path passes one. This closes the double-grant race
     that any check-then-insert guard leaves open. It is a **different failure
     from the missing grant above and not a substitute for fixing it** — a
     uniqueness constraint cannot help when the insert never ran.
   - Make the renewal `order_no` deterministic too, so `insertOrder` is
     idempotent under the existing `orders.order_no` unique index. Preferred
     over a unique index on `(sub_id, sub_period_start)` because it needs no
     migration.
   - Tests are part of this item, not a follow-up, and they belong in the
     database tier against real Postgres per [tests/README.md](tests/README.md):
     replay a paid order whose credit row is missing, replay a renewal order
     whose credit row is missing, and deliver the same event twice
     concurrently. Writing these first would have caught the bug.
   - Borrowed shape: `dojo-video-web`'s `handleInvoicePaid` performs the
     subscription sync and the credit grant inside one transaction, keyed by an
     idempotency key derived from the billing period.
   - Deliberately **not** in this item: ledger columns, webhook receipt fields,
     reconciliation, and refund reversal. They are item 5. This item is scoped
     to stop losing money and to prove it with tests.

5. [x] [P1] Give Stripe money movement an auditable record
   - Follows item 4 and depends on nothing else. Item 4 stops the bleeding;
     this is what makes the next discrepancy findable instead of anecdotal.
   - Credit ledger columns: `balance_after`, `actor`, `metadata`. A credits row
     carries only `order_no` today, so "why does this org have 340 credits" is a
     join through orders and a guess. `balance_after` is the one that matters —
     it turns silent ledger drift into an inconsistency a script can detect.
     `actor` distinguishes `stripe:webhook` from `admin:<id>` from `system`.
   - Webhook receipts: denormalize and index `stripe_customer_id`,
     `stripe_invoice_id`, `stripe_subscription_id`, and `stripe_object_id`,
     plus `livemode`, `api_version`, and `request_id`. The payload is `text`
     today, so "every event for this subscription" is a full scan and a JSON
     parse.
   - [x] Add `action_required` alongside `processing | completed | failed`. "This
     price is not in the plan catalog" is not transient and three days of Stripe
     retries will not fix it. Without this status the reconciliation script
     below has nothing to query, and a human-decision case is indistinguishable
     from a transient blip. **Shipped — step 3 below, which also records that an
     unmapped price was not merely skipped: it recorded a paid order granting
     zero credits.**
   - Reconciliation script: walk recent paid Stripe invoices, assert a local
     order, credit row, and webhook receipt for each, and exit nonzero on
     drift. Model: `dojo-video-web`'s `scripts/reconcile-stripe-billing.js`.
   - [x] Stripe client polish — **step 5 below, shipped 2026-07-28 ahead of the
     rest of this item** because it is independent of the migrations and removes
     a production footgun on its own.
     - `src/integrations/stripe.ts` is now the only place that constructs a
       client, and it sets `appInfo` and `maxNetworkRetries`. The four
       per-request `new Stripe(...)` calls in the webhook and billing portal
       handlers are gone. `maxNetworkRetries: 2` is *pinned, not raised* — it
       matches the SDK's current default, and is stated so an upgrade cannot
       quietly lower it.
     - `tests/unit/architecture.test.ts` now fails the build on `new Stripe(`
       outside that file. Four handlers had already drifted into their own
       client, so the rule is what stops a fifth.
     - Test-mode events are rejected in production on `livemode`, before the
       event is claimed, so the delivery stays replayable once the secret is
       fixed. The test is `livemode !== true` rather than `=== false`: fail
       closed, since Stripe always sets the field.
     - **400, not 500.** Stripe stops retrying a 4xx and shows the failure on
       the endpoint in the dashboard — where the operator has to go anyway. A
       500 would retry for three days and bury the cause. The signature has
       already verified at that point, so what is being caught is a production
       deployment holding a test-mode webhook secret, not a forgery.
     - Deliberately not a catalog error code: Stripe is the only reader of that
       body, and the catalog would demand five locale translations for a string
       no person sees. Added as a launch gate in
       [docs/release-checklist.md](docs/release-checklist.md) instead.
     - Left alone: the client caches `STRIPE_PRIVATE_KEY` at first construction,
       so rotating the key needs a redeploy rather than taking effect on the
       next request. Correct for serverless, where instances are short-lived.
   - ~~Open decision: whether a refund should reverse credits automatically.~~
     **Closed 2026-07-28 — see *Refund handling* below.** `dojo-video-web`
     reverses automatically, keyed off the original grant's idempotency key and
     refusing when the balance no longer covers it; this template will not.
   - Explicitly **not** borrowed: `dojo-video-web`'s webhook answers 200
     unconditionally, so a failed event is never redelivered and recovery rests
     entirely on its cron and scripts. Keep this template's 500.
   - Order of work, smallest blast radius first. The first two are additive
     columns and can ship on their own; the script is worth little until
     `action_required` exists to give it something to query:
     1. [x] `balance_after`, `actor`, `metadata` on `credits` — one migration,
        backfill `balance_after` as null rather than guessing history.
        **Done 2026-07-28**, migration `0018`, three additive nullable columns
        and no backfill. Six new database-tier tests in
        `tests/db/credits.ledger.test.ts`; 422 tests green. What the work turned
        up, because none of it was in the plan:
        - **`balance_after` needed a lock, which was the whole cost of the
          item.** It is a read-then-write, so two concurrent grants both read a
          total of 0 and both stamp 10 for a ledger that sums to 20 — and
          nothing throws. `insertSpendCreditIfSufficient` already held a per-org
          advisory lock; the grant paths did not. `lockOrgAndSumLedger` in
          `src/models/credit.ts` is now shared by all of them, including inside
          the fulfillment transaction. Verified by deleting the lock and
          watching the concurrency test fail with `[10, 10]`.
        - **It is the ledger total, not the spendable balance.** Credits expire
          without writing a row, so a spend-aware figure would drift from the
          sum by design and a script could not tell that from real corruption.
          The invariant is `prev.balance_after + row.credits =
          row.balance_after`.
        - **`actor` is not `user_uuid`.** `user_uuid` is who was credited;
          `actor` is who decided to. On an admin grant those are two different
          people, and only the second is accountability. Typed as a template
          union (`` `admin:${string}` `` and friends) so an unnamespaced string
          will not compile.
        - `balance_after` is **omitted** from `CreditInsert` rather than
          optional, so no caller can supply a figure it did not compute. The
          compiler then found all nine call sites needing an `actor`; each got a
          real one rather than a default, because a default would be applied by
          the site that forgot to think about it.
        - Named `metadata_json`, not `metadata`, matching `files` and `tasks`.
          Two real writers rather than a stub column: a task spend records
          `task_uuid`, a refund records what it reverses.
     2. [x] Receipt fields on `stripe_webhook_events`, denormalized at write time
        from the payload already being stored. **Done 2026-07-28**, migration
        `0019`: `stripe_object_id`, `stripe_customer_id`, `stripe_invoice_id`,
        `stripe_subscription_id`, `livemode`, `api_version`, `request_id`.
        18 new tests (10 unit over the extractor, 8 database-tier); 440 green.
        - Extraction lives in `src/services/stripe/receipt.ts`, not the model.
          The model takes values and puts them in columns; every assumption about
          Stripe's object shapes is in one file with tests over it.
        - **Reads the object's own `object` discriminator, not `event.type`.**
          There are ~250 event types and a handful of shapes, so a type switch
          would be long and — the real objection — *silently* incomplete: a newly
          handled event type would extract nothing and log no complaint.
        - The trap worth naming: **an invoice carries no `invoice` field.** For
          `kind === "invoice"` the id is the object's own, and reading only the
          reference would leave `stripe_invoice_id` null on exactly the events
          reconciliation walks. Same for subscriptions. Both are pinned by tests.
        - Expandable fields are `string | Object`, so both resolve to the id — a
          handler that expands `customer` would otherwise write a null.
        - Every failure here is silent: a wrong read writes a null, the webhook
          still succeeds, and the gap only surfaces when the reconciliation query
          comes back empty during an incident. Hence the unit tier, and hence the
          database tests **query by** the columns rather than only asserting they
          were written.
        - Nulls are load-bearing and distinguished from empty strings, because
          `where stripe_invoice_id is null` silently misses `''`. `livemode`
          keeps `false` (test mode) apart from `null` (pre-0019).
        - The retry path refreshes the receipt alongside the payload rather than
          leaving whatever the first attempt wrote — a receipt disagreeing with
          the payload it came from is worse than a null, which is visibly absent.
        - Three indexes, one per question actually asked: customer, invoice,
          subscription. `stripe_object_id` is unindexed on purpose — nothing
          queries by it, and an unread index is write cost on every delivery.
        - Fell out of the work: `stripe_webhook_events` was **not** in the db
          tier's `MANAGED_TABLES`, so its rows leaked across tests. No test wrote
          them before, so nothing was broken yet. Added.
        - Deployment note in the migration: the three `CREATE INDEX` statements
          block writes while they build, which means webhook deliveries 500 and
          Stripe retries. Milliseconds on a small table; on a large one, create
          them by hand with `CONCURRENTLY` first.
     3. [x] `action_required` status, and the handful of `return` sites in the
        webhook that should use it instead of throwing — an unmapped price is
        the motivating case. **Done 2026-07-28**, no migration: `status` is a
        `varchar` and the allowed values live in a comment, so this is code plus
        a documented status. 13 new tests; 453 green.
        - **The motivating case was worse than a `return`.** `plan` was resolved
          from the price id and then *never checked*, so `credits` fell through to
          `?? 0`. A renewal on a price missing from `src/config/pricing.ts`
          recorded a **paid order granting nothing** — product name taken from the
          Stripe nickname, so the order looked plausible — and marked the event
          completed. The customer paid, got no credits, and nothing said so. Found
          while reading for this step; it is the same class of defect as item 4,
          in a place item 4 did not look.
        - Six sites converted, all previously bare `break`s that fell through to
          `markStripeWebhookEventCompleted`: renewal invoice with no subscription,
          no period, unmapped price, unresolvable user, unresolvable org, and all
          three `unmapped` results from `syncStripeSubscription`. Every one of them
          recorded "handled" for work that did not happen.
        - **200, not 500.** The status code is the whole mechanism: 500 keeps
          Stripe retrying for three days over a condition that will not change,
          and 200 stops it. `ActionRequiredError` in
          `src/services/stripe/action-required.ts` is what the route branches on.
        - Still **reclaimable by a deliberate replay**, like `failed`. The
          automatic retries are already stopped, so the only delivery that arrives
          is one a human triggered after fixing the cause — refusing it would mean
          the fix could not be applied to the event that found the problem.
        - `reason` is short and stable (`unmapped_price`), the identifiers go in
          `detail`, and `describe()` renders one line into `last_error`. A sweep
          groups by the reason, so it must not vary with the specifics; absent
          fields are dropped rather than printed as `undefined`.
        - `last_error` is reused rather than a new column added: it holds "why
          this row is not completed", which covers a thrown error and a
          human-decision case alike. Renaming it would be a migration for no gain.
        - Policy stays in the route, next to the statuses it writes.
          `syncStripeSubscription` keeps returning its typed result and the route
          decides which classifications need a human — `stale` completes, since a
          stale event is an ordering artifact and parking it would fill the queue
          with rows needing no action.
        - Deliberately left alone: `handleCheckoutSession` throws `AppError` for
          its own unresolvable cases, so they still 500 and retry. Some are just
          as permanent (an `order_no` in metadata matching no order), but that is
          a separate pass over a different file, and this step is scoped to the
          sites that were silently completing.
     4. [x] Reconciliation script + a cron sweep over `failed` and
        `action_required`. **Done 2026-07-28**, no migration. 29 new tests; 482
        green. Three parts:
        - **`pnpm reconcile:stripe`** — `scripts/reconcile-stripe-billing.ts`.
          Checks a paid order with no ledger row (item 4's bug shape), a
          `balance_after` that disagrees with the ledger (step 1's payoff), and a
          paid Stripe invoice with no recorded event (step 2's payoff, via the
          `stripe_invoice_id` index). Exits 1 on error.
        - **Written in TypeScript, run through `tsx`**, unlike the `.mjs` scripts
          beside it. The logic lives in `src/services/stripe/reconcile.ts` where
          the database tier tests it; a `.mjs` script would re-implement the same
          SQL and drift from it silently, which is the exact failure this script
          exists to catch. `tsx` was already a devDependency.
        - `--local-only` needs no Stripe key, so the checks that caught this kit's
          two real defects run in CI and on a laptop. Without a key it warns and
          degrades rather than pretending to have checked Stripe.
        - **Warnings exit 0 deliberately.** A parked event is a human's queue, and
          a check that blocks every deploy until someone maps a price is a check
          that gets switched off. Only `error` — money and entitlement actually
          disagreeing — fails the run.
        - **Cron sweep** in `src/services/stripe/sweep.ts`, on the existing
          five-minute cron. `action_required` is stuck by definition; a `failed`
          row is only stuck once Stripe has given up, so the cutoff is four days —
          three plus margin — because under that it is a transient blip Stripe is
          still retrying. Alerts are bucketed to the hour: an unfixed problem
          should keep reminding you, not train you to ignore the channel.
        - The sweep **does not retry anything**, on purpose. A `failed` row past
          its retries needs the stored payload replayed through the handler, and a
          parked one needs a human decision first. Both are real features; neither
          is "notice the problem", which is what this is.
        - **Refund handling, implementing the settled spec.** `charge.refunded`
          and `charge.dispute.created` now compute the reversal — grant, current
          balance, shortfall — park the event as `action_required`, *and* keep the
          immediate Slack alert. Both, because they fail differently: a message is
          scrolled past, a row is not looked at unless something says to.
        - Computed **at write time**, since the shortfall is the decision being
          handed over and recomputing it a day later gives a different answer once
          the balance has moved. Uses the spendable balance, not the ledger total:
          expired credits cannot be taken back.
        - `findCreditByOrderNo` finally has a caller — kept unused through item 4
          for exactly this.
        - Fell out of the work: **`enqueueJob` returned `void`, so a deduped
          insert was indistinguishable from a created one.** It now returns
          whether a job was created, because the sweep reports "alerted" and would
          otherwise take credit for a message the dedupe key suppressed.
        - **Known gap, honestly recorded rather than guessed at:** a refund on a
          *one-off checkout* charge cannot be resolved to an order. Orders store
          `stripe_session_id`, the charge carries `payment_intent`, and nothing
          links them. Renewals resolve fine through the invoice. Such a refund is
          still parked, with `resolution: "order_unresolved"` — which is itself the
          information a human needs. Closing it means adding
          `stripe_payment_intent_id` to `orders`; tracked under *Technical Debt
          Worth Scheduling*.
     5. [x] Cached Stripe client, `livemode` rejection. Independent of the rest;
        pick it up any time. **Done 2026-07-28** — taken first for exactly that
        reason. Details under *Stripe client polish* above. **Step 1 is now the
        top of the queue.**
   - **Refund handling: decided 2026-07-28 and approved by the repo owner —
     record the reversal, never apply it automatically.** This is the spec step 4
     builds against, written out rather than left as "we decided not to", which
     would not survive contact with the code.
   - The reasoning corrects a premise worth naming. The comment above the refund
     handler used to justify not reversing on the grounds that it is a judgement
     call. It is — but *not because consent is missing*. **Stripe has no
     customer-initiated refund**, so by the time `charge.refunded` arrives
     someone with dashboard access has already approved it, and auto-reversal
     would be executing a decision already made rather than making one. That
     argument does not hold. These are the ones that do:
     - A **chargeback bypasses the operator entirely.** `charge.dispute.created`
       is the customer going to their bank. The funds are debited immediately and
       contested afterward, and the dispute may be won — so reversing can be
       wrong in both directions.
     - "Operator approval" is really **anyone with dashboard access**; a teammate
       or a support contractor produces an identical event.
     - A **partial refund is not a full revocation.** $10 back on a $50 order
       does not map onto revoking the grant.
     - The credits **may already be spent**, making the reversal arithmetically
       impossible rather than merely unwise. This is the one that rules out
       auto-apply outright: there is no correct silent answer, and both available
       ones — leave a negative balance, or revoke less than was refunded — are
       decisions someone has to own.
   - Behaviour to build in step 4. No event touches credits automatically; each
     writes an `action_required` row:
     - `charge.refunded` — carrying the refunded amount, the original grant's
       `trans_no`, the current balance, and the shortfall when the balance no
       longer covers the grant.
     - `charge.dispute.created` — flagged as a dispute, because the outcome is
       not yet known.
     - `invoice.voided` and `credit_note.created` — same as a refund.
   - Three constraints on that row, each of which is the point of the decision:
     - **It is a queue, not a log.** The row stays `action_required` until a
       human resolves it, which is what lets step 4's script find it. A Slack
       message — what ships today — is something someone scrolls past.
     - **Compute the arithmetic at write time** rather than linking out to
       Stripe. The shortfall *is* the decision the operator is being asked to
       make, and recomputing it later gives a different answer once the balance
       has moved.
     - **A human-chosen reversal goes through the ordinary credit path**, as a
       negative grant with a deterministic `trans_no` keyed `refund:<charge_id>`,
       so a double click collides on the unique index instead of double-revoking.
       Same mechanism item 4 established; no new machinery.
   - This is why **step 3 gates step 4**: without `action_required` there is no
     row for any of the above to be written to.

6. [x] [P1] Remove serverless collision risk from generated ids
   - Promoted out of technical debt: it is a deployment-shape bug, not
     housekeeping. `getSnowId()` in `src/lib/hash.ts` defaulted to one worker id,
     and serverless runs many instances of it at once.
   - Unique indexes protect data integrity, but a collision still becomes a
     user-visible failed insert on a financial record. Prefer UUIDv7 or another
     instance-safe id for new financial and usage records.
   - Interaction with item 4: the deterministic `trans_no` and `order_no` values
     added there are derived from Stripe ids, not from `getSnowId()`, so that
     work neither depends on this nor is undone by it.
   - **Done 2026-07-28**, no migration. 9 new tests; 491 green.
     - `newId()` in `src/lib/ids.ts` returns UUIDv7, and **`src/lib/hash.ts` and
       the `simple-flakeid` dependency are deleted** rather than deprecated. The
       roadmap said "prefer UUIDv7 for *new* records"; a preference erodes, and
       leaving a function named `getSnowId` in place is leaving the footgun. All
       ten call sites moved.
     - v7 over v4 to keep the leading timestamp: B-tree inserts stay local, and
       adjacent ids were still made at about the same time, which is a debugging
       habit the snowflake ids supported.
     - `uuid@11` was **already a dependency** and exports `v7`, so this removed a
       dependency rather than adding one. No hand-rolled generator.
     - **Second bug found in the same read.** The affiliate invite code was
       `parseInt(snowflakeId).toString(36).slice(-8)`, which inherited the
       collision problem *and* made codes guessable: consecutive ids differ only
       in their low bits, so one real code told you roughly what the next ones
       would be — for a link that pays an attribution reward. Now `newShortCode()`,
       `randomInt` over a 32-character alphabet with `I`/`L`/`O`/`U` removed
       because these get read off a screen and retyped. A test asserts the *first*
       character varies across a sample, which is what catches a shared-prefix
       regression; a format check would not.
     - **No backfill, and none needed.** Existing rows keep numeric ids. These are
       opaque `varchar(255)` keys — checked that nothing parses or sorts them
       numerically before changing anything, and item 4 had already established
       non-numeric `order_no` values. Expect all three shapes side by side.
     - `tests/unit/architecture.test.ts` fails the build on a `simple-flakeid` or
       `@/lib/hash` import. The rule bans the *library*, not the pattern — a
       snowflake is fine where a worker id is actually assigned, and this
       deployment target does not assign one.
     - The uniqueness tests draw 10k–20k ids and assert no duplicate. That does not
       prove "never collides"; it catches a generator that is not drawing
       uniformly, which is the failure a format assertion misses.

7. [ ] [P1] Make rate limiting fail loudly instead of degrading quietly
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

8. [ ] [P1] Write the account-deletion policy, then build it
   - **Trigger, not a date: do this before your first real user.** Deletion and
     export are legal obligations from the moment you hold someone else's
     personal data, and the privacy policy shipped in item 2 already makes
     retention promises that nothing implements yet. Deferred on 2026-07-26
     because the product is pre-launch and has no such users.
   - **Scope narrowed on 2026-07-28.** What remains is *erasure on request*.
     The abuse half is built and is a different operation: suspension
     (`users.banned_at`, session revocation) plus an `email_blocklist` checked
     at signup, in `src/services/moderation.ts` and `/moderation` in the admin
     console. Deleting an abuser was always the wrong tool — it frees the
     address to register again and destroys the evidence — so nothing about
     erasure blocks responding to a bot wave any more.
   - The policy comes first and is a table: for every table, erase /
     anonymize / retain. Financial records (`orders`, `subscriptions`) are
     retained; `credits.user_uuid` is anonymized but the row stays;
     `auth_events` is append-only by design.
   - Tenancy raised the cost: deciding what happens when the sole owner of a
     shared team deletes their account is a product flow, not a query. That
     decision is the blocker on starting, not the implementation. See
     [docs/organizations.md](docs/organizations.md).

9. [ ] [P1] Make a fresh clone run without Docker
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

10. [ ] [P1] Org switcher
    - A user can now belong to several organizations and has no way to move
      between them. `getOrgContext` picks active → personal → first.
    - Blocks nothing else, but makes the path-scoped tenant routes below worth
      doing.
    - Audit note: this is P1 only for a B2B product. If the product built on
      this template is B2C or single-workspace, it can wait indefinitely.

11. [ ] [P2] Move tenant routes under `/[locale]/[org]/`
    - `getOrgContext(req, orgSlug)` already accepts a slug; nothing passes one.
    - Path scoping beats session-only: with the org held only in the session,
      two browser tabs on two organizations fight over one value and the loser
      silently acts in the wrong tenant.
    - Large: it moves every page and every link. Its own change.

12. [ ] [P2] "Request upgrade" flow
    - A member hitting checkout gets `BILLING_OWNER_ONLY` with a clear message,
      but nothing tells the owner they were asked.

13. [ ] [P2] Dedicated billing role
    - Billing is owner-only. Mature products split it out so finance can hold
      billing without product access. Additive on top of `can()`.

---

## Catching the Admin Console Up

From an audit on 2026-07-28. The admin app's last *functional* change predates the
tenancy and billing work: across items 4–6 it gained one argument. Its foundation
is sound — MFA gate, `admin_ro`/`admin_rw`, enforced CSP, an explicit column
allowlist so `signin_ip` and `stripe_customer_id` never reach a browser, audit
logging, real test coverage. What lagged is **scope**, not quality.

Four shipped on 2026-07-28 — the two that made recent billing work visible, then
the two that made it reachable for a team:

- [x] **Ledger audit columns reach the UI.** `balance_after`, `actor`, and
  `metadata` now render in the admin credits panel. They are **opt-in** via
  `includeAudit`, because `getOrgCreditSummary` also feeds the customer's own
  account page and `actor` can read `admin:<uuid>` while `metadata` carries Stripe
  event ids. `balanceAfter` ships to everyone — it is the org's own arithmetic, and
  a ledger you cannot check is one you have to trust.
- [x] **A Stripe events page.** `action_required` was a status with no console:
  the only surfaces were a Slack message and a CLI script. Now a filterable list
  with the parked reason and the receipt ids, plus a count on the overview.
  **Read-only deliberately** — the obvious next feature is a replay button, and
  that is a write path into billing needing `admin_rw`, an audit entry, and a
  decision about replaying a half-applied event. The `payload` column is never
  selected: it holds the whole Stripe object, including a customer's email and
  address, and a payload nobody fetches cannot leak.

Items 14–22 all shipped on 2026-07-28. The console can now answer the questions
an operator actually arrives with, and — with 19–22 — let them find the row to
ask about. What is left for this section is written at the end of item 16: the
webhook's switch statement still lives inside its route handler, which is what a
console-side replay would need lifted out first.

14. [x] [P1] Make admin org-aware, not personal-workspace-only
    - Every admin billing path resolved `findPersonalOrganizationByUserUuid`:
      credits, plan snapshot, comps. Since tenancy shipped, users belong to team
      orgs with pooled credits and org-scoped Stripe customers, and **admin could
      not see or act on any of them.** There was no org list or search anywhere.
    - **Done 2026-07-28.** `/organizations` lists and searches every tenant;
      `/organizations/[uuid]` shows members, pooled credits with the full audit
      trail, plan, subscriptions, and paid orders — all keyed on the org uuid,
      with no personal-org resolution anywhere in the path.
    - Search covers name, slug, uuid, **and `stripe_customer_id`**. That last one
      is the lookup that motivated the box: an operator has a Stripe tab open
      showing `cus_…` and needs to know whose it is.
    - The user-centric panels on the overview still act on the personal workspace
      and now **say so**, with a link to Organizations. Previously they implied
      they covered everything.
    - Read-only. Granting credits and comping a tier remain user-and-personal-org
      scoped; making those org-targeted is its own change, because a write path
      that can suddenly reach any tenant deserves more than a new argument.
    - Turned up a live bug in the first version of the member count, worth
      recording because it is a Drizzle trap rather than a typo: **interpolated
      columns render unqualified inside a `sql` template.** A correlated subquery
      became `where "organization_id" = "id"`, where `"id"` bound to the *inner*
      table. Both columns exist, nothing errored, and every count came back 0.
      Now an aggregate over a LEFT JOIN, with the counts asserted.
15. [x] [P1] Show Stripe subscription state
    - Admin could comp a tier and read a plan snapshot, but nothing showed Stripe
      status, current period, or `cancel_at_period_end`. "I cancelled and I am
      still being charged" was unanswerable from the console, which is the exact
      question the `subscriptions` table was added to answer.
    - **Done 2026-07-28** as part of the org detail page. Shows tier, status,
      source, period end, whether it cancels, when it ended, and the Stripe
      subscription id — Stripe's vocabulary stored verbatim, so the table can be
      compared against the dashboard without a mapping.
    - Lists **every** subscription row, not just the active one: a canceled row
      beside a new one is the shape of an upgrade, and hiding it makes a support
      question unanswerable. A comp shows as `manual` with no Stripe id, so an
      operator can tell who is actually paying.
    - The plan panel calls out `cancelAtPeriodEnd` explicitly, since that is the
      case a customer complains about and the answer is "still on the tier you
      paid for, until the period ends".
16. [x] [P2] Resolve parked events from the console
    - **Done 2026-07-28, and renamed: resolve, not replay.** The item asked for
      both. Working through it, replay turned out to be a feature that already
      exists in the right place and resolve turned out to be the one genuinely
      missing — so the scope changed rather than the estimate.
    - **Replay already works, from Stripe.** `action_required` is in
      `RECLAIMABLE_STATUSES`, so pressing Resend in the Stripe dashboard reclaims
      the row and re-runs it against a freshly signed payload and Stripe's
      *current* state. Every write on that path derives its key from the Stripe
      object, so a replay cannot double-charge or double-credit. What was missing
      was nobody saying so: the console now spells out the two exits and which is
      which.
    - A console button replaying the **stored** payload was rejected. It would
      run a snapshot of the past through the money path — a payload captured
      before the operator fixed the cause is the wrong input — and it would need
      the webhook's 600-line switch lifted out of its route first. Worth doing
      one day for testability; not worth doing as a side effect of adding a
      button.
    - **Resolve was the real gap.** An `action_required` row for work a human did
      elsewhere — refunded by hand, dispute accepted — had no way to stop being a
      work order. It sat in the queue, in the sweep's alert, and in the overview's
      count forever, and a queue that cannot be emptied is one people stop
      reading. New terminal status `resolved` (migration 0021) with
      `resolved_at`, `resolved_by`, and a **required** note.
    - Terminal on purpose: a later redelivery is acknowledged and not re-run, so
      Resend cannot silently undo a person's decision. `claimStripeWebhookEvent`
      treats `resolved` like `completed`. That is a real constraint and the UI
      says so at the point of clicking.
    - The status guard is in the UPDATE's `WHERE`, not a preceding read, so a
      resolve racing a redelivery that just reclaimed the row loses cleanly
      instead of stamping a human note over a run in flight. The endpoint reports
      that as a status conflict rather than a success — an endpoint that answers
      200 when it changed nothing would make the queue look emptied while the row
      stayed parked.
17. [x] [P2] Thicken the orders table
    - `select()` on paid orders with no org column, no link to the credit row
      that fulfilled it, no status filter, and three coexisting order-number
      formats with nothing explaining them.
    - **Done 2026-07-28.** `/orders` has a status filter, search across
      `order_no`, `sub_id`, org, user uuid and email, an org link, and a column
      allowlist that keeps `order_detail` and `paid_detail` — raw provider
      payloads — out of the browser.
    - The column that justifies the page is **Granted**: `orders.credits` against
      the ledger rows carrying that order number. A paid order promising credits
      with none granted is item 4's defect, seen one row at a time where an
      operator is already standing when a customer says the credits never
      arrived. Two rows for one order is the opposite defect and is flagged too.
    - Fetched as a second query rather than a LEFT JOIN: an order with two ledger
      rows would duplicate the order in a joined result and corrupt the
      pagination — hiding the exact anomaly the column exists to show.
    - Order numbers are now labelled by shape. `renewal:<sub>:<period>` is
      derived from the billing period so a redelivery collides instead of billing
      twice; the rest are per-checkout ids, newer ones UUIDv7.
18. [x] [P2] Surface reconciliation in the console
    - `pnpm reconcile:stripe --local-only` already computed the findings and
      showed them only to someone with a checkout, a database URL, and a
      terminal. Wrong audience: the person who needs to know a customer paid and
      got no credits is whoever is reading the support ticket.
    - **Done 2026-07-28.** `/reconciliation` runs `reconcileLocalBilling()` over a
      7/30/90-day window, grouped by finding kind with what each one means and
      where to act on it. Read-only; it computes nothing new.
    - **The local half only**, and the page says so rather than letting a green
      result imply more than it checked. The Stripe half walks the invoice API,
      needs a live secret key, and takes as long as the account is large — not
      something to hang a page render on. It stays in the script, which is also
      the only thing that can catch "Stripe charged them and we were never told".

A second pass on 2026-07-28, after the moderation work landed, found the console
could now *do* most of what an operator needs and still could not help them
*find* the row to do it to. Items 19–22 are that gap. They are deliberately
unglamorous — search, paging, a count — and **all four shipped on 2026-07-28**,
in that order: first the one deciding whether the rest of the console is usable
on a real user base, then the counts and searches an abuse incident leans on,
then paging everywhere, and last the question of what the overview is for. 16–18
remain open.

19. [x] [P1] Give the console a way to find a user
    - **The blocking gap.** `listAdminUsers` took only page and limit; the
      overview showed the newest 20 and there was no search box, no filter, and no
      per-user page anywhere in the app.
    - Every user-targeting tool — grant credits, comp a plan, suspend an account
      — takes a raw `uuid` and told the operator to "find the user's UUID on the
      overview". For anyone outside the newest 20 that instruction resolved to
      "open Postgres". Moderation was the sharp case: the panel that exists to end
      an abuse wave could not locate the abuser.
    - **Done 2026-07-28.** `/users` searches `email`, `uuid`, and `nickname`
      through `ilike` and pages at 50, following the shape item 14 settled — a GET
      form, so a search is a URL that pastes into a ticket. `/api/admin/users`
      takes the same `q`. The overview keeps its latest-20 table and links here;
      `/moderation` now points at the search rather than at the overview.
    - Searching `uuid` matters as much as `email`: it is the value every write
      tool takes, and a partial id from a log line is half of how an operator
      arrives. An address search deliberately returns **every** provider's row,
      since `users.email` is unique per `signin_provider` — seeing one row and
      suspending it while its sibling stays open is the mistake that shape
      prevents.
    - Not searched: `signin_ip` (a surveillance surface with no support question
      behind it) and `stripe_customer_id` (belongs to the org, and
      `/organizations` already searches it).
    - Results go through the existing column allowlist, and
      `tests/db/admin.users.test.ts` asserts that on the row keys rather than on
      the select list — the way it breaks is a bare `select()` added by someone
      who needed one more column.
    - **Known cost:** a leading-`%` `ilike` cannot use an index, so this is a
      sequential scan per search. Identical to what `/organizations` has done
      since item 14, and fine at starter scale. The fix when it stops being fine
      is a trigram index (`pg_trgm`) on `email`, not a rewrite of the page.
    - A per-user page at `/users/[uuid]` is the natural follow-on and was left
      out: the search box alone unblocks the tools that already exist.
20. [x] [P2] Fix the suspended-accounts count, and page the list
    - `/moderation` rendered `Suspended accounts ({banned.length})` over a
      `limit: 50` query, so the number silently pinned at 50 and the rest of the
      list was unreachable — during exactly the incident the page exists for,
      when "how many did we catch" is the question being asked.
    - **Done 2026-07-28.** The count comes from `countAdminBannedUsers()` and the
      table has the pager `/organizations` and `/stripe-events` already had.
    - The count landed in `apps/admin/lib/data.ts` rather than staying in
      `src/models/user.ts`, which reverses what the technical-debt entry below
      originally proposed. The reason showed up while writing it: a total and its
      rows must share a predicate, and splitting the pair across two files is how
      they drift. All four other admin list/count pairs already live together
      there. `listBannedUsers`/`countBannedUsers` were deleted, closing that debt
      item outright rather than half-closing it.
    - The blocklist had the matching hole — `listBlocklist` paged but did not
      filter, so "is this address already blocked" was only answerable through
      the ban panel's Load status, one address at a time. There is now a search
      box, and **it is not a substring match**, which is the whole point: a rule
      is stored under its normalized key, so an admin pasting
      `a.b+spam@gmail.com` out of a signup log is hunting a row that reads
      `ab@gmail.com`. The service normalizes the term first and searches the key,
      the original input, *and* the domain — so a domain rule covering the
      address surfaces too, which is the rule nobody thinks to look for. A plain
      `ilike` would have answered "not blocked" in both cases, and that is the
      one wrong answer this box must never give.
    - Normalizing stayed in the service. `src/models/email-blocklist.ts` says in
      its header that callers pass normalized values, so the model takes a
      prepared `BlocklistSearch` — raw text for the substring half, exact keys
      for the normalized half — rather than growing a second copy of the rule.
21. [x] [P2] Make paging consistent across the console
    - Only `/organizations` and `/stripe-events` paginated. `/feedbacks` and
      `/audit` were hard-capped at 100, `/reservations` and `/affiliates` at
      their defaults. Past the cap the data was not merely unpaginated, it was
      invisible, with nothing on the page saying so.
    - `/audit` was the one that mattered beyond convenience: it is the compliance
      surface, the answer to "who changed this and when" — asked long after the
      change, about an entry by then nowhere near the newest hundred. Retention
      for that table is still open under Technical Debt; a log you cannot read
      back is worse than one that grows.
    - **Done 2026-07-28.** One `Pager` in `apps/admin/components/pager.tsx`, now
      on all eight lists. `/audit`, `/feedbacks`, `/reservations`, and
      `/affiliates` gained paging; the four hand-rolled copies were deleted.
      `countAdminReservations` and `countAdminAffiliates` were added, because a
      list without a count cannot page honestly.
    - The shared version takes a **total** instead of guessing from
      `rows.length === pageSize`, which every copy did and which is wrong twice:
      it offers a Next link into an empty page whenever the total divides evenly
      by the page size, and it can never say how much is left. It now reads
      "Page 3 of 47 · 2310 rows" — a list that stops at its cap no longer looks
      complete. `tests/components/pager.test.tsx` pins the even-division case
      specifically, since it stays invisible until a table holds exactly 50 rows.
    - `/stripe-events` picked up a real fix on the way: its pager counted the
      whole table while the list was filtered, so filtering to nine parked events
      offered pages of nothing. It counts the selected status now.
22. [x] [P2] Decide whether the overview should be a dashboard
    - **Decided 2026-07-28: no, and four tiles instead.** The bar was set by the
      Stripe `action_required` count from item 15 — a number that changes what
      the operator does next, placed where they already are — and only things
      clearing it were built.
    - Shipped: signups in the last 7 days beside the user total (a bot wave shows
      up as a rate that does not match the product, and the tile points at
      `/moderation`), live subscriptions with `past_due` called out (payments to
      chase), suspended accounts (is moderation keeping up), and parked Stripe
      events. The three that mean "act now" go red at non-zero.
    - Rejected, and worth recording so they are not re-proposed: revenue,
      conversion, and churn, which the Stripe dashboard renders better; and
      **credits outstanding**, which sounded right in the original list above but
      is a finance figure with no action attached and would need a global ledger
      aggregate to compute honestly. A tile nobody acts on teaches people to stop
      reading the row.
    - `countSubscriptionsByStatus()` groups in one pass rather than counting per
      status, matching `countStripeWebhookEventsByStatus`. Which statuses *mean*
      something stays with the caller — `past_due` entitles during a grace period,
      and that product decision lives in the entitlement service.

## Technical Debt Worth Scheduling

These are not product features, but they are unfinished pieces of starter
readiness that came out of the code audit. Treat them as small, isolated
hardening passes rather than one giant schema rewrite.

- [P1] Make the affiliate reward idempotent
  - The last known instance of the pattern item 4 removed from billing:
    `updateAffiliateForOrder` checks `findAffiliateByOrderNo` and then inserts,
    with no unique index on `affiliates.paid_order_no` behind it. Two concurrent
    webhook deliveries for one order can both pass the check and both write a
    reward.
  - Smaller stakes than the billing bug — it is a payout we owe a referrer, not
    credits a customer paid for — which is why it was not folded into item 4.
    The fix is the same shape: unique index, then let the insert conflict.
  - Sweep duplicates before adding the index; a paid order that already earned
    two rewards will block the migration.
- [P1] Link a Stripe charge to its order for one-off payments
  - Item 5 step 4 can resolve a refund back to its order for **renewals**, through
    the invoice's subscription and period. A one-off checkout charge has no
    invoice: `orders` stores `stripe_session_id`, the charge carries
    `payment_intent`, and nothing joins them.
  - The consequence is bounded rather than silent — such a refund is still parked
    as `action_required` with `resolution: "order_unresolved"`, so a human sees it
    — but they get no grant, balance, or shortfall, which is the arithmetic the
    row exists to hand over.
  - Fix is a column: `stripe_payment_intent_id` on `orders`, written at checkout
    and indexed. Recorded here rather than only in step 4's notes, because a
    sub-bullet on a shipped item is where a known gap goes to be forgotten.
- [P1] Bring `apps/admin` under the architecture rules
  - `apps/admin/lib/data.ts` imports `@/db` directly. The rule "calls `db()` only
    from the model layer" scans `FILES = sourceFiles(SRC)` — `src/` only — so
    admin is exempt **by accident of a path, not by decision.**
  - Cross-tenant reads genuinely are legitimate in an admin console, so the answer
    is probably an explicit allowlisted exemption rather than a refactor. Either
    way it should be written down and tested, not left to the reach of a regex.
  - The logger rule already walks `apps/admin/app` and `apps/admin/lib`, so the
    walker exists; only the layering rules stop at `src/`.
- [x] [P2] Retire the duplicate banned-user queries in `src/models/user.ts`
  - `listBannedUsers` and `countBannedUsers` were added alongside the moderation
    work and were reachable only from tests; the console reads
    `listAdminBannedUsers` in `apps/admin/lib/data.ts` instead.
  - Not merely dead, which would have been harmless. The model pair did a bare
    `select()` while the admin version selects through the explicit column
    allowlist that keeps `signin_ip`, `stripe_customer_id`, and `invite_code` out
    of the browser. Two ways to list the same rows, one without the guard, is how
    the next page gets wired to the wrong one.
  - **Done 2026-07-28** with item 20. Both were deleted and the count was added
    beside `listAdminBannedUsers` instead, so the pair shares a predicate and a
    file. See item 20 for why that beat the "keep the model one" plan recorded
    here first.
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

Migrations `0018`–`0019` add the audit trail for money movement:

- **`0018` is safe to run any time, on any database.** Three `ADD COLUMN`s with
  no default and no `NOT NULL`: a brief lock, no table rewrite, no backfill.
  Existing rows keep nulls in all three, which reads as "written before this
  migration" — see the comment in the migration for why guessing history would
  be worse than leaving it null.
- **`0019` adds columns instantly but builds three indexes.** The `ADD COLUMN`s
  rewrite nothing. The `CREATE INDEX` statements each take a lock that blocks
  writes on `stripe_webhook_events` while they build, so webhook deliveries 500
  and Stripe retries them. On a small table that is milliseconds. If yours holds
  millions of events, create the three indexes by hand with `CONCURRENTLY` first
  and the migration skips them — drizzle wraps migrations in a transaction, and
  `CONCURRENTLY` cannot run inside one.

**Two things that cost time and are not obvious:**

- **`pnpm db:migrate` and `pnpm test:db:setup` are separate databases.** After
  any migration, run both, or `pnpm test:db` fails with a column that does not
  exist rather than a clear "you forgot to migrate".
- **A generated migration is content-hashed once applied.** Drizzle records the
  hash, so editing an already-applied file makes it look like a new, unapplied
  migration. Add the explanatory header before the first `db:migrate`, not after,
  and treat an applied migration as immutable.

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
