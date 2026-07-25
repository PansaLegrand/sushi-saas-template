# Plans, tiers, and entitlements

Every user is on exactly one tier, always. `free` is a real tier with a real
row in the catalog — not the absence of a subscription — so no call site
anywhere needs a null check before asking what someone may do.

```
src/types/plan.ts        the vocabulary: tier names, feature keys, limit keys
src/config/plans.ts      the catalog: what each tier costs you to honour
src/services/entitlements.ts   the only module that reads the catalog
src/models/subscription.ts     typed CRUD over the subscriptions table
src/services/subscriptions.ts  keeps the table in step with Stripe
```

## The one rule

**Nothing outside `src/services/entitlements.ts` may read the catalog or
compare a tier name.** Call sites ask for a capability:

```ts
await requireEntitlement(userUuid, "tasks.text_to_video");
await enforceLimit(userUuid, "storage.totalMb", { current, adding });

if (await can(userUuid, "storage.upload")) { … }
const max = await limitOf(userUuid, "storage.maxFileMb");
```

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

Add it to `Tier` in `src/types/plan.ts`, add its entry to `PLANS` with a fresh
`rank`, list its Stripe price IDs, and add its name to `TIER_LITERALS` in the
architecture test. Nothing else changes.

## Where tiers come from

`subscriptions` holds one row per subscription — Stripe's or a comp — and it is
the *current state* of the billing relationship. `orders` remains the immutable
financial log: what was paid, when, and for what. The two answer different
questions and must not be merged. Answering "is this user on a paid plan" from
`orders` means scanning for the newest row whose `expired_at` has not passed,
which gets slower as the log grows and gets the answer wrong the moment
someone cancels mid-period.

`resolvePlan` reads every live subscription for the user and takes the
**highest-ranked entitling** one. A user can legitimately hold two — a comped
Max alongside a paid Plus — and taking the most recent instead of the best
would quietly downgrade them.

### What "entitling" means

| Status | Entitles? |
| --- | --- |
| `active`, `trialing` | Yes, until `current_period_end` passes |
| `active` + `cancel_at_period_end` | Yes, until the period ends — they paid for it |
| `past_due` | Yes, for `PAST_DUE_GRACE_DAYS` (7) after the period ended |
| `canceled`, `unpaid`, `incomplete`, `paused` | No |

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
  expiresAt: null,          // indefinite
  note: "design partner",
});

await revokeManualSubscriptions(userUuid);  // paid rows are untouched
```

This is also how you try a gated feature locally without a Stripe account.

## Downgrades

A user who drops to a smaller plan while over its limits **keeps everything
they have**. Limits are checked at creation time only: new uploads and new
generations wait until they are back under, and nothing is deleted.

This is a deliberate product decision, not an oversight. Background deletion on
downgrade is what a naive implementation produces, and it destroys customer
data in response to a billing event.

## Credits and tiers

They are different mechanisms and the boundary is worth stating:

- **Entitlements gate capabilities** — whether you may use a feature at all,
  how large a file, how many generations this month.
- **Credits meter consumption** inside a capability you already have.

`includedMonthlyCredits` in the catalog is what each tier advertises, rendered
on the billing screen. Paid credits are granted by the order flow, whose
amounts come from `src/config/pricing.ts` — this kit does **not** grant from
the catalog as well, because two grant paths means double-granting. If you want
the free tier to receive a monthly allowance, add a job handler that calls
`increaseCredits` and enqueue it from the cron route; see
`src/services/jobs/handlers.ts`.

## What is deliberately not here

- **Refund and chargeback reversal.** `charge.refunded` and
  `charge.dispute.created` raise a Slack alert and are not auto-reversed.
  Clawing back credits a user has already spent is a decision with enough
  product judgement in it to belong to a human. What the kit will not do is
  stay silent.
- **Proration display.** Stripe's billing portal handles plan changes and shows
  the proration; the billing page links to it rather than reimplementing it.
- **Seats and per-organization billing.** Tiers here are per user. See the
  roadmap.
