# Upgrading an adopted starter

Keep the starter's Git remote separately from the product's origin, and record
the last adopted starter commit in your release notes. Upgrades are reviewed
source changes; never replace an application's files wholesale with a template.

1. Fetch the starter remote and compare from the last adopted commit. Review
   security fixes, migrations, lockfile/runtime changes and environment contracts.
2. Create an upgrade branch in the product repository. Apply focused fixes in
   dependency order; preserve product identity, plan policy and provider adapters.
3. Review every migration against a restored disposable copy. Use the same
   backup/restore drill and integrity checks documented in this repository.
4. Run the applicable lint, database, coverage, browser and production artifact
   checks. A core-only build does not validate admin or Content Studio releases.
5. Deploy expand-only schema before code that reads new columns. Deploy related
   web/worker changes in the order specified by their engineering contract.
6. Verify deployed revision, readiness, job progress and reconciliation. Local
   test success and a pushed commit do not establish live-provider correctness.

## Release evidence

Record the source SHA, Node/pnpm versions, migration range, changed environment
variables, test results, security scan results and rollback constraints. Keep
application, admin, worker, Content Studio and detached website revisions
explicit. Content Studio owns its database/migrations and has an independent
release train. Cross-link public guide changes to the application release.

For each release, use [release-checklist.md](release-checklist.md). Run
`pnpm test:production` after building web/admin and `pnpm benchmark:ledger --
--check` for the financial hot path. Provider sandbox checks require disposable
credentials and are separate from the hermetic/local suites.

## Domain scaffolding

`pnpm scaffold:domain invoice-drafts --dry-run` previews the eight files.
Omit `--dry-run` to create typed DTO, config, model, service, API wrapper, guarded
GET route, auth-gate test and implementation worksheet under the horizontal
layers. Existing paths are never overwritten. Invalid/path-traversal names fail
before writing. No `src/features` tree is created.

Generated domains are deliberately disabled and do not contain a database table
or business mutation. Complete the worksheet, tenant schema, entitlements,
privacy inventory, five-locale copy and real behavior tests before enabling the
domain. This is an extension starting point, not a finished SaaS feature.
