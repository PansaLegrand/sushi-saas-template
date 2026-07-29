# Changelog

All notable changes to this project are documented here.

The format follows Keep a Changelog and releases use Semantic Versioning once
the project publishes its first stable version.

## Unreleased

### Added

- Distributed Redis-backed rate limiting for authentication and critical
  mutation checkpoints.
- Stripe checkout-intent idempotency and a consolidated server-owned billing
  catalog.
- Tab-local organization context and a responsive account workspace shell, so
  concurrent browser tabs cannot race through one session-wide tenant choice.
- Dependency readiness checks for environment, PostgreSQL migrations, Redis,
  and the durable job queue.
- Atomic storage quota reservations and durable private-object deletion.
- Database-enforced reservation overlap protection, replayable booking intents,
  and atomic paid-booking confirmation.
- Recursive structured-log redaction and bounded request IDs shared by edge and
  server runtimes.
- Responsive admin navigation, operational summaries, status treatments, and
  accessible table pagination.
- Open-source contribution, security, conduct, and issue-management policies.
- CodeQL, dependency review, Dependabot, and OpenSSF Scorecard workflows with
  pinned third-party actions and least-privilege permissions.

### Changed

- Production environment validation now requires the services needed by the
  durable job runner and distributed abuse controls.
- Credit spending now allocates first-expiring grants first and preserves
  replay-safe physical allocation/refund rows behind one logical transaction.
- Checkout and payment records retain allowlisted reconciliation receipts
  instead of complete Stripe request or payment objects.
- Reservations remain opt-in, but their scheduling and checkout path now has
  database-enforced concurrency guarantees.
- Customer and admin surfaces now share responsive, accessible page structure,
  localized catalog errors, loading/empty states, and keyboard-safe controls.
- Public documentation and editorial content moved to an independent Git
  repository; this repository now builds only the SaaS and its admin console.
- The package identity, metadata, examples, and runtime defaults are neutral for
  downstream adopters.

### Security

- Removed unused AI-provider dependencies that carried production audit
  advisories.
- Serialized organization membership mutations and disabled unsafe generic
  organization deletion.
- Made affiliate rewards database-idempotent under concurrent webhook delivery.
- Added atomic last-owner/last-workspace guards, explicit ambiguous-tenant
  failures, password-reset session revocation, and fail-closed Redis behavior on
  authentication and checkout.
- Added uniqueness and replay constraints around affiliate rewards, checkout
  intents, reservation intents, storage quota claims, and credit mutations.

## Release process

When cutting a release:

1. move Unreleased entries into a dated version section;
2. run lint, coverage, real infrastructure tests, and both production builds;
3. verify pending migrations and update deployment notes;
4. tag the exact commit used to build the release;
5. open a fresh Unreleased section.
