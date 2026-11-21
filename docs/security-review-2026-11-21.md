# Production readiness review — 2026-11-21

Reviewed baseline `e632762` and all 11 open GitHub pull requests. Changes are on
`codex/saas-security-review`. This review covers source, dependency advisories,
CI failure logs, real local PostgreSQL/Redis contracts, and production artifacts.
It does not certify a deployment or guarantee absence of other vulnerabilities.

## Decision

Do not launch the baseline unchanged. It contains vulnerable authentication and
framework versions plus independently confirmed authorization defects. Apply the
fixes from this branch, complete deployment configuration and provider sandbox
checks, and require normal CI/owner review before release. No production data,
GitHub PR state, remote branches, or deployments were changed during this review.

## Findings and repairs

| Priority | Finding and consequence | Resolution / evidence |
| --- | --- | --- |
| P0 | Better Auth 1.7.6 is covered by GHSA-965c-763c-88jm, an OAuth state account-takeover advisory. Google OAuth is configurable in this starter. Framework versions also predate critical Next.js fixes; exploitability varies with enabled features. | Better Auth 1.7.27; web/admin Next 15.5.29; Studio Next 16.4.6; React 19.3.1; Zod 4.6.7. Real credential, recovery, MFA and ban tests exercise the upgraded adapter. |
| P1 | Payload user self-update authorized on numeric ID alone. Service accounts and editor users have separate sequences, so a machine identity can match an editor ID and reach account updates, including credential fields. | Require the `users` collection and matching ID. A regression against the actual collection access function failed before the fix and passes afterward; anonymous, own-user, other-user and admin cases included. |
| P1 | Public Better Auth membership mutations bypass application boundaries. Direct invite/accept lacks the lock held by application routes; SDK `/organization/leave` never calls `beforeRemoveMember`, bypassing the last-workspace rule and serialized owner protection. | Both web and admin HTTP handlers block direct invite/accept/reject/cancel/add/remove/role/leave. Server `auth.api` remains available inside guarded application operations. Encoded/trailing-slash variants are tested; real HTTP leave preserves membership in PostgreSQL. |
| P1 | Marking an account banned and revoking sessions are separate writes. A partial revocation failure or concurrent sign-in could leave an authenticated session; role checks alone would still authorize it. | Live ban checks in the SDK middleware and application identity/tenant/admin resolvers. A real persisted session is rejected after a ban even when deliberately retained; sign-out still works. |
| P2 | Task reads used the 10/minute task-admission limiter, while the UI polls every 1.5 seconds. Ordinary long-running jobs hit 429 and consume creation allowance. This also appears in PR #72 onboarding failure logs. | Separate 120/minute read bucket; admission stays 10/minute. A route regression performs 40 reads and proves creation allowance remains available. |
| P1 deployment | Stripe webhook API version was unspecified in deployment instructions. Newer invoice shapes remove `invoice.subscription` and line price fields, so using the dashboard default can strand renewals/refunds for manual repair. | Explicit client pin and deployment requirement: `2025-02-24.acacia`. SDK-major migration remains separate. Validate an actual signed recurring invoice and refund before accepting payments. |

Primary advisories: [Better Auth OAuth state](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm),
[Next image optimization](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw),
[Next cookie disclosure](https://github.com/vercel/next.js/security/advisories/GHSA-f3mh-rxg3-f5g2).
The audit establishes affected installed versions, not proof that every optional
vulnerable feature is exposed by this application.

## Review coverage and existing safeguards

- **Authentication:** credential signup and duplicate handling, verification,
  reset and session revocation, optional Google account linking, TOTP enrollment,
  backup codes, lockout, server-owned MFA assurance, cookies and HTTP origin/rate
  guards. Actual Google OAuth and email deliverability still need staging checks.
- **Authorization:** membership lookup from authenticated user IDs; explicit
  tenant context for multi-workspace APIs; unknown-role fallback; owner-only
  billing; admin read/write separation; live role lookup and per-session MFA.
  File/task lookups use organization scope before signing private URLs.
- **Membership:** owner preservation and last-workspace rules, locked membership
  mutations, invitation email binding and seat capacity. Public SDK alternatives
  were the missing boundary, now closed for managed mutations.
- **Money and jobs:** durable webhook claims, signed delivery, replay identities,
  transactional quota/credit reservation, worker fencing, refunds, and action-
  required outcomes. Real database suites exercise concurrent debits and replay.
- **Account lifecycle/storage:** fresh-session checks for sensitive actions,
  redacted session references, resumable erasure and export, private presigned
  object access, quota and deletion workflows. Live Garage/object-provider flows
  were not rerun because the existing Docker engine has read-only storage.
- **Studio:** separate database/auth, editor roles, machine scopes and expiry,
  signed SaaS gateway. Initial admin bootstrap must happen behind private access
  before exposing an empty Studio deployment; this is not SaaS user auth.
- **Operations:** explicit migrations, schema safety tests, production env and
  identity gates, durable-worker requirement, readiness, backup/restore runbooks,
  security headers and standalone production smoke tooling.

## Dependency and PR decisions

No PR was merged or closed. CI results were inspected as historical evidence;
passing an old PR run is not validation of this combined branch.

| PR | Review decision |
| --- | --- |
| [#75 Actions group](https://github.com/PansaLegrand/sushi-saas-template/pull/75) | Pinned action updates, green recorded CI; reasonable independent merge after fresh CI. Left separate from application fixes. |
| [#74 production group](https://github.com/PansaLegrand/sushi-saas-template/pull/74) | Do not merge unchanged: dependency-review failed on vulnerable transitive packages, and it leaves pinned Next versions behind security releases. This branch applies newer security fixes selectively; Payload stays 3.90.2 to avoid an unvalidated authoring migration. |
| [#73 pino-pretty](https://github.com/PansaLegrand/sushi-saas-template/pull/73) | Applied 13.2.0 locally; recorded CI green. |
| [#72 Vercel CLI](https://github.com/PansaLegrand/sushi-saas-template/pull/72) | Proposed 65.2.0 has failed security/onboarding checks. Updated locally to 66.6.0 with patched transitive dependencies; CLI version command verified. One Zod 3 advisory remains dev-only. |
| [#71 Stripe server](https://github.com/PansaLegrand/sushi-saas-template/pull/71) | Do not merge: actual build failure at `scripts/reconcile-stripe-billing.ts:106`, missing `Invoice.subscription`. Requires coordinated renewal/refund/reconciliation migration and sandbox replay. |
| [#70 Stripe browser](https://github.com/PansaLegrand/sushi-saas-template/pull/70) | Recorded CI green; optional major, no identified security need. Retained current browser SDK. |
| [#69 Node types](https://github.com/PansaLegrand/sushi-saas-template/pull/69) | Keep Node 24 typings aligned with the shipped Node 24 runtime; Node 26 types can accept APIs unavailable in production. |
| [#68 jsdom](https://github.com/PansaLegrand/sushi-saas-template/pull/68) | Recorded CI green, compatible with current Node 24 requirement; optional test-only major, deferred. |
| [#67 uuid](https://github.com/PansaLegrand/sushi-saas-template/pull/67) | Recorded CI green; current 11.1.1 already fixes its advisory. No production need to take the major here. |
| [#66 Next ESLint](https://github.com/PansaLegrand/sushi-saas-template/pull/66) | Do not merge alone: existing lint config fails with the major. Root remains on matching patched 15.5.29; Studio uses 16.4.6. |
| [#59 cross-env](https://github.com/PansaLegrand/sushi-saas-template/pull/59) | Optional tool-only major with failed recorded browser CI. Existing command behavior works on supported Node; deferred. |

The root test-runner major upgrade was evaluated separately. Vitest 4 passes the
suite but changes branch instrumentation: the measured 59.07% fails the existing
73% gate. Preserve the gate and current major pending a dedicated migration;
do not hide this by lowering coverage thresholds.

## Residual dependency risk

The final production audit has **zero advisories**. The full developer-tree
scan still reports **one high** Zod 3 advisory under the Vercel CLI, and **three
moderate** Vitest/mocker advisory entries (two unique advisories) under the root
Vitest 3 runner. These remain visible; no advisory IDs were ignored. Do not expose
a development test server or run CLI tooling against untrusted projects.

The existing `.pnpmfile.cjs` hook was updated to the reviewed Better Auth version:
it excludes the optional Vitest peer used only by `better-auth/test-utils`, which
this app does not import. This preserves the original production/test dependency
boundary. It does not remove the root test runner or hide its audit findings.
Security overrides also patch transitive packages; keep them under review when
upgrading their parent packages. Vercel reports an optional WASI binding peer
warning (`@emnapi/core`); the native CLI starts, but deployment was not exercised.

## Launch conditions and limits

1. Run Node **24.22.1+ within Node 24**, as declared in `.nvmrc`/engines. This
   shell initially selected Node 20; all validation here explicitly selected 24.
2. Run `pnpm customize`, production environment/identity checks and
   `pnpm launch:check` against the intended deployment. No production secrets or
   release target were supplied, so these are not asserted green here.
3. Apply committed SaaS and Studio migrations explicitly before compatible code
   rollout. No new schema migration is introduced by this review.
4. Validate Google OAuth callbacks, verification/reset email delivery, admin MFA,
   signed Stripe checkout/renewal/refund events, and private storage upload/
   complete/download/delete on a disposable staging deployment.
5. Run a durable worker, configure Redis and a trusted client-IP source, bootstrap
   Studio privately, exercise backup restoration, and review CSP reports before
   enforcement. CSP defaults to report-only; it is not an active XSS block.
6. Team members can read shared organization data, spend shared credits and delete
   shared files by design. Org admins cannot manage billing; owners can. Confirm
   that these defaults match the real product before adding domains.

## Validation

- `pnpm install --frozen-lockfile`: passed on Node 24.22.1 / pnpm 10.22.0.
- `pnpm lint`: passed for web, admin and Studio, including migration safety.
- Root and Studio TypeScript checks: passed. One initial parallel type check
  raced Next's regeneration of `.next/types`; a subsequent serialized check passed.
- Full PostgreSQL/Redis `pnpm test:cov`: **1,292 tests passed**, no skips.
  Statements/lines 69.18%, branches 74.90%, functions 72.68%; all gates passed.
- Hermetic coverage: **991 tests passed**; statements/lines 44.39%, branches
  73.05%, functions 55.50%. The floors were raised slightly, never lowered.
- Studio: **37 tests passed**, including the reproduced collection-ID regression.
- `pnpm build`: web, admin and Studio production builds passed. Production
  smoke passed web/admin startup, mobile login, chunks, headers, health and
  localized anonymous redirect. These checks do not exercise external providers.
- `pnpm audit --prod`: **0 vulnerabilities**. Full audit: **4 advisory entries**
  (1 high, 3 moderate), all under development tooling as described above.
- No SaaS schema changes or production migrations were performed.

Docker could neither write to its existing PostgreSQL volume nor create a new
container (`read-only file system`). Homebrew PostgreSQL 16 was installed and a
fresh cluster under `/tmp/sushi-review/pgdata` plus a separate Redis process were
used instead. No existing database was truncated. The temporary services were
stopped after validation; the PostgreSQL installation remains available.

The full Docker/Garage browser suite, container image scans, live Payload admin
workflow, Google OAuth, mail, Stripe sandbox and production deployment are not
claimed verified. Those are the remaining acceptance boundaries.
