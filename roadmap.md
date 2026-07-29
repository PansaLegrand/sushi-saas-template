# Roadmap

This file tracks product-neutral starter work. Public guides, marketing copy,
and blog planning belong in the detached documentation-site repository.

## Tier-one baseline

The starter currently includes:

- verified Better Auth signup, password recovery, OAuth, MFA support, session
  revocation, CAPTCHA, and Redis-backed abuse controls;
- organization-scoped authorization, personal workspaces, invitations, role
  management, and serialized last-owner/last-workspace guards;
- a Stripe Price-ID catalog, checkout-intent idempotency, webhook replay
  protection, stacked subscriptions, reconciliation, and an immutable credit
  ledger with atomic FEFO spend/refund behavior;
- private object storage with atomic quota reservation and durable deletion;
- durable jobs, migration/readiness checks, structured redacted logs, audit
  trails, security headers, legal-policy scaffolding, and a separate admin app;
- unit, route, service, component, PostgreSQL, and Redis test tiers plus CodeQL,
  dependency review, Dependabot, and OpenSSF Scorecard workflows.

## Launch gates

These are operator or policy decisions a reusable codebase cannot complete:

- [ ] Fill in `src/config/legal.ts`, reconcile retention promises with actual
      account-erasure behavior, and obtain legal review.
- [ ] Configure production email, Stripe, Redis, private object storage, log
      retention, database backups, and a tested restore procedure.
- [ ] Enforce branch protection and required CI checks in the hosting provider.
- [ ] Move the CSP from report-only to enforcement after reviewing production
      reports for the deployed provider set.
- [ ] Run every manual flow in `docs/release-checklist.md` against the production
      configuration.

## Next engineering investments

These improve assurance without changing the starter's product model:

- [ ] Add a small Playwright deployment-smoke suite for signup, organization
      switching, checkout handoff, upload, and admin authentication.
- [ ] Add restore-drill automation and a documented recovery-time objective.
- [ ] Add optional telemetry adapters for error tracking and OpenTelemetry while
      preserving the no-vendor default.
- [ ] Expand route coverage whenever a new mutation surface is added; every
      money or credit mutation must retain a replay test.
- [ ] Publish versioned upgrade notes and an example downstream upgrade workflow
      after the first tagged release.

## Explicit non-goals

- Product-specific AI providers, marketing copy, and public documentation content
  do not belong in this repository.
- The starter does not choose a legal jurisdiction, data-retention promise,
  support SLA, observability vendor, or payment refund policy for adopters.
- The detached documentation site is neither a branch nor a submodule. It has
  its own history and release cycle, and the SaaS links to it through
  `NEXT_PUBLIC_DOCS_URL`.
