# Product Extension Decisions

The starter includes product-neutral foundations, but it should not silently
choose commercial policy or invent an API/onboarding contract. This document
marks the boundary so adopters know what is ready, what is deliberately absent,
and where to extend it.

## Billing

Already included:

- Stripe Price-ID catalog for monthly/yearly Plus and Max products;
- promotion-code entry in Checkout;
- organization-owned customers, idempotent purchase intents, and replay-safe
  checkout/renewal credit fulfillment;
- active/trialing/past-due/canceled subscription state with out-of-order event
  protection;
- Billing Portal for invoices, payment methods, and cancellation;
- refunds/disputes, stuck-event operations, and local/Stripe reconciliation.

Deliberately policy-owned:

- trial duration and whether trial users receive credits before first payment;
- automatic tax, tax registrations, invoice numbering, and merchant-of-record
  choices;
- refund eligibility and proration/product upgrade rules;
- regional price presentation beyond the USD/CNY catalog examples.

Add these through `src/config/billing.ts` and `src/services/stripe/**`, retaining
the existing idempotency and webhook replay tests. Do not enable a Stripe switch
without specifying how its asynchronous events change the local ledger.

## Public API and API Keys

The shipped `/api/**` surface is the browser/application contract and uses
session + organization authorization. The starter does not advertise a public
developer API or issue API keys because a secure key model depends on product
decisions that do not yet exist: scopes, service accounts versus human owners,
rotation/recovery, per-key quotas, audit retention, versioning, and the resources
external clients may access.

When the product needs an external API:

1. Define a versioned `/api/v1/**` contract and scope vocabulary first.
2. Store only a hash and visible prefix of high-entropy keys; show the secret
   once and support overlapping rotation.
3. Bind every key to an organization and immutable audit actor.
4. Reuse service-layer writes—never add an API-only mutation path.
5. Rate-limit per key plus trusted client IP and add auth-gate/replay tests.
6. Publish deprecation and pagination/error-envelope contracts.

Shipping a generic key table before those choices would create a security
surface without a useful API behind it.

## End-user Onboarding

Developer onboarding is included: guided customization/environment setup,
doctor, local infrastructure, idempotent demo data, full-stack browser contracts,
and one launch-readiness audit.

End-user onboarding is deliberately not a global wizard. The correct completion
steps depend on the adopted product—upload a file, invite a teammate, connect a
data source, generate a video, or create a reservation. Implement it as a domain
service with durable completion events once those steps are known. Avoid a
single mutable `onboarding_complete` boolean; additive step keys let a product
introduce a new step without resetting every existing customer.

## One Launch Audit

Run the read-only aggregate gate against the production profile:

```bash
pnpm launch:check
pnpm launch:check -- --skip-containers   # Vercel/serverless release
pnpm launch:check -- --dry-run
```

It runs product identity, environment, migration policy, container (unless
skipped), applied migration ledger, relational integrity, and retention preview
checks. It never applies migrations, deletes data, deploys, or sends messages.
`MIGRATION_DATABASE_URL` may point it at a direct database connection while the
application keeps `DATABASE_URL` pooled.
