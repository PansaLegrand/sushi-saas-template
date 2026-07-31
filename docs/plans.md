# Plans, tiers, and entitlements

Every organization is on exactly one tier, always. `free` is a real tier with a real
row in the catalog — not the absence of a subscription — so no call site
anywhere needs a null check before asking what someone may do.

```
src/types/plan.ts        the vocabulary: tier names, feature keys, limit keys
src/config/billing.ts    prices, intervals, credits, and Stripe Price mappings
src/config/plans.ts      capabilities and limits for each tier
src/services/entitlements.ts   the only module that reads the catalog
src/models/subscription.ts     typed CRUD over the subscriptions table
src/services/subscriptions.ts  keeps the table in step with Stripe
```

## The one rule

**Nothing outside `src/services/entitlements.ts` may read the catalog or
compare a tier name.** Call sites ask for a capability:

```ts
await requireEntitlement(ctx.orgUuid, "tasks.text_to_video");
await enforceLimit(ctx.orgUuid, "storage.totalMb", { current, adding });

if (await can(ctx.orgUuid, "storage.upload")) { … }
const max = await limitOf(ctx.orgUuid, "storage.maxFileMb");
```

Entitlements resolve per **organization**, not per user: the plan is bought by
the tenant, so a member joining a team on `max` gets `max`, and the owner
leaving does not downgrade everyone else. `ctx` comes from `getOrgContext()` —
see [organizations.md](organizations.md).

`ctx.orgUuid` is a branded `OrgUuid`, so passing a user uuid to any of these is
a compile error. It used to be a silent free-tier answer.

`tests/unit/architecture.test.ts` fails the build on an import of
`@/config/plans` from anywhere else, and on any `tier === "max"` comparison.

The reason is extensibility, and it is the whole design. With entitlements,
adding a tier or moving a feature between tiers is an edit to one file. With
tier comparisons scattered across routes and components, it is a grep you will
not finish — and the call site you miss is the one that gives a free account a
paid feature.

## Adding a feature

Three steps, and TypeScript enforces the middle one:

1. Add the key to `PlanFeature` or `PlanLimit` in `src/types/plan.ts`.
2. Fill it in for **every** tier in `src/config/plans.ts`. `Record<PlanFeature,
boolean>` means a tier that omits the key does not default to `false` — it
   fails to compile, and whoever adds the feature is made to decide what it
   means for each tier they already sell.
3. Guard the call site with `requireEntitlement` or `enforceLimit`.

Limits use `null` for unlimited (`UNLIMITED` reads better in the table). One
representation, because `Infinity` does not survive `JSON.stringify` — a
catalog written with it would mean one thing on the server and another in the
browser.

## Adding a tier

Add it to `Tier` in `src/types/plan.ts`, add its capabilities to `PLANS` with a
fresh `rank`, add its commercial products to `src/config/billing.ts`, and add
its name to `TIER_LITERALS` in the architecture test. The billing catalog is
the one source for amounts, intervals, credit grants, and Stripe Price IDs;
`config/plans.ts` derives its price-to-tier mapping from it.

## Where tiers come from

`subscriptions` holds one row per subscription — Stripe's or a comp — and it is
the _current state_ of the billing relationship. `orders` remains the immutable
financial log: what was paid, when, and for what. The two answer different
questions and must not be merged. Answering "is this user on a paid plan" from
`orders` means scanning for the newest row whose `expired_at` has not passed,
which gets slower as the log grows and gets the answer wrong the moment
someone cancels mid-period.

`resolvePlan` reads every live subscription for the organization and takes the
**highest-ranked entitling** one. A user can legitimately hold two — a comped
Max alongside a paid Plus — and taking the most recent instead of the best
would quietly downgrade them.

### What "entitling" means

| Status                                       | Entitles?                                                 |
| -------------------------------------------- | --------------------------------------------------------- |
| `active`, `trialing`                         | Yes, until `current_period_end` passes                    |
| `active` + `cancel_at_period_end`            | Yes, until the period ends — they paid for it             |
| `past_due`                                   | Yes, for `PAST_DUE_GRACE_DAYS` (7) after the period ended |
| `canceled`, `unpaid`, `incomplete`, `paused` | No                                                        |

The grace period exists because Stripe retries a declined card for days.
Cutting access off on the first failure treats an expired card exactly like a
cancellation, and generates the support ticket you least want.

## Keeping in step with Stripe

`src/services/subscriptions.ts` copies Stripe's subscription object wholesale
on `customer.subscription.created`, `.updated`, and `.deleted`. It never
computes a transition itself — Stripe already decided, it sends the decision
with every event, and a second implementation of the same state machine
eventually disagrees with the first about someone's access.

Two properties make that safe:

- **Redelivery is harmless.** The write is an upsert keyed on
  `stripe_subscription_id`.
- **Out-of-order delivery is harmless.** Every row records the timestamp of the
  event it was written from, and the upsert's `WHERE` clause drops anything
  older. Without it, a delayed `updated` landing after the `deleted` that
  followed it resurrects a cancelled subscription — and nothing in the logs
  looks wrong.

`checkout.session.completed` also triggers a sync, so a user is entitled by the
time they land back from Checkout rather than whenever
`customer.subscription.created` happens to arrive.

### Checkout retries and multiple subscriptions

Checkout is idempotent per **purchase intent**, not per organization or plan.
The browser sends one `Idempotency-Key` for a click and reuses it for an
uncertain network retry. The database maps `(org_uuid, checkout_intent_id)` to
one order; that stable order number is also Stripe's idempotency key. Reusing
the key with a different canonical product, Price ID, currency, or locale is a
`409` conflict.

A deliberate second purchase generates a new intent key, so the same
organization may hold several independent subscriptions. Their credit grants
remain additive in the ledger, while `resolvePlan` selects the highest-ranked
active subscription for capabilities. Do not replace the intent index with a
unique constraint on organization, Stripe Customer, product, or active
subscription—that would turn retry protection into a product limitation.

If a subscription cannot be attributed to a user, or carries a price that is
not in the catalog, the sync **refuses to guess** — it logs an error and raises
a Slack alert. Both mean a paying customer without access, and neither fixes
itself.

## Comping an account

Every product eventually needs to put someone on a paid tier for free. A comp
is a normal subscription row with `source = "manual"` and no Stripe id, so it
resolves through exactly the same path as a paid one:

```ts
await grantManualSubscription({
  userUuid,
  tier: "max",
  expiresAt: null, // indefinite
  note: "design partner",
});

await revokeManualSubscriptions(userUuid); // paid rows are untouched
```

This is also how you try a gated feature locally without a Stripe account.

## Organization seats and admin exceptions

`organization.members` is a normal plan limit: Free has one total seat (the
owner, so it cannot invite), Plus has five, and Max has twenty. Owners, admins,
and members all consume one seat. A live pending invitation reserves one too,
so an organization cannot issue many links for its final seat and let
acceptance order decide who receives it.

Support can set `organizations.member_limit_override` from the organization
detail page in the admin console. An active override wins over the plan without
changing the Stripe subscription; clearing it or reaching
`member_limit_override_expires_at` falls back to the plan immediately. Every
set/reset requires a reason and is written to `admin_audit_logs`.

The precedence is deliberately small and explicit:

```
active organization override -> resolved plan limit -> catalog default
```

Do not model a VIP exception by changing the subscription tier. Billing truth
and a support exception answer different questions and have different audit
trails.

## Downgrades

A user who drops to a smaller plan while over its limits **keeps everything
they have**. Limits are checked at creation time only: new uploads and new
generations wait until they are back under, and nothing is deleted.

Seats follow the same contract. Existing members retain access after a plan or
override downgrade. New invitations stop when `members + live pending
invitations` reaches the new cap, and invitation acceptance rechecks the live
member count because the limit may have changed since the email was sent.

This is a deliberate product decision, not an oversight. Background deletion on
downgrade is what a naive implementation produces, and it destroys customer
data in response to a billing event.

## Credits and tiers

They are different mechanisms and the boundary is worth stating:

- **Entitlements gate capabilities** — whether you may use a feature at all,
  how large a file, how many generations this month.
- **Credits meter consumption** inside a capability you already have.

`PLAN_MONTHLY_CREDITS` in `src/config/billing.ts` is the single source for both
the billing screen and paid credit grants. Monthly products grant that amount;
yearly products grant twelve months upfront. Checkout stores the catalog grant
on the order, and webhook replay-safe fulfillment writes it to the ledger once.

The free tier advertises zero monthly credits because the kit does not run a
recurring free allowance job. Signup credits are a separate one-time onboarding
grant. If you add a monthly free allowance, add a job handler that calls
`increaseCredits`, enqueue it from the cron route, and then update
`PLAN_MONTHLY_CREDITS.free`.

## Stripe Price contract

Every recurring product must use a pre-created Stripe Price. Production startup
requires Plus and Max monthly/yearly Price IDs and rejects values that do not
look like `price_...`. Checkout never falls back to inline `price_data`: an
inline recurring Price cannot be mapped reliably when subscription and renewal
webhooks arrive.

New checkouts use the server-only `STRIPE_PRICE_*` variables. Legacy
`NEXT_PUBLIC_*` variables remain mapped so existing deployments and
grandfathered subscriptions keep their tier and renewal grant. CNY variants are
optional and appear in the UI only when their Price ID is configured.

## What is deliberately not here

- **Refund and chargeback reversal.** `charge.refunded` and
  `charge.dispute.created` raise a Slack alert and are not auto-reversed.
  Clawing back credits a user has already spent is a decision with enough
  product judgement in it to belong to a human. What the kit will not do is
  stay silent.
- **In-place plan and quantity changes.** The starter intentionally disables
  `subscription_update` in its named Stripe Billing Portal configuration.
  Credits are granted once per catalog subscription, so a mutable quantity or
  prorated price change would make money and entitlement disagree. Customers
  may cancel, update payment methods, inspect invoices, or purchase another
  independent subscription from the app. Add a tested proration/credit policy
  before enabling portal plan changes.
- **Seat-quantity Stripe billing.** Plans cap organization membership, but the
  Stripe price is still a flat organization price. Charging per added seat
  needs a tested quantity/proration policy before subscription updates can be
  enabled.

Production requires `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` (`bpc_...`). The
app retrieves that exact configuration on every portal open and fails closed if
`features.subscription_update.enabled` has drifted to true in Stripe.
