# Contributing

Thank you for helping improve the starter. Changes should preserve its central
promise: a clean checkout is secure by default, understandable without private
context, and safe to adapt into a real product.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Use an issue to discuss large schema, authentication, billing, or architecture
  changes before investing in an implementation.
- Never include credentials, customer data, production logs, or private URLs in
  an issue, fixture, screenshot, or commit.
- Read `AGENTS.md` for the layer rules, `docs/errors.md` before adding an error
  path, `docs/database.md` before changing the schema, and `tests/README.md`
  before adding tests.

## Local setup

Requirements:

- Node.js 24.22.1 or newer, below Node.js 25
- pnpm 10.22.0
- Git and a running Docker daemon for PostgreSQL, Redis, and private object storage

Bootstrap a fresh checkout:

```bash
export SAAS_STARTER_PROFILE=core
pnpm starter core install
pnpm starter core setup
pnpm starter core doctor
pnpm starter core demo
```

Core setup creates local-only secrets, starts the development services,
and applies migrations. It never overwrites an existing env file. The demo
command seeds a local account and starts the web app **and durable worker**,
using the local image mock and disabling external email, Slack, and Stripe.
See the README Quick Start for the first-result check.

After that check, stop the demo with `Ctrl-C` and use `pnpm starter core dev`
for ordinary development. Keep `SAAS_STARTER_PROFILE=core` in the shell so lint
and commit hooks do not require the optional Content Studio workspace.
Use `operations` for admin work or `publishing` for Content Studio; run that
profile's install and setup before its dev command.

## Making a change

1. Branch from the current default branch.
2. Keep the change focused. Avoid drive-by formatting or dependency churn.
3. Follow the one-way architecture:

   ```text
   app routes → services → models → database
   ```

4. Add a regression test for a bug and tests at the lowest tier that proves a
   new invariant.
5. For money or credit mutations, add a replay test. For routes, add an
   authentication-gate test that proves data functions were not called.
6. For schema changes, commit the generated SQL and Drizzle metadata together.
   Migrations must be expand/contract safe.
7. Update co-versioned engineering documentation when behavior, configuration,
   or deployment steps change.

## Validation

Run the selected profile's checks:

```bash
pnpm starter core lint
pnpm test:cov
pnpm starter core build
```

The complete CI pipeline also validates the admin console and Content Studio.
For changes to those applications, install the `publishing` profile and run
`pnpm lint && pnpm build` as well. A fresh Core onboarding job independently
checks the documented first-result journey; see `tests/README.md`.

The real-database tier requires `TEST_DATABASE_URL` and `TEST_REDIS_URL`:

```bash
pnpm test:db:setup
pnpm test:db
```

Do not lower coverage thresholds to make a build green.

## Commits and pull requests

- Use Conventional Commit subjects such as `feat:`, `fix:`, `docs:`, `test:`,
  `refactor:`, or `chore:`.
- Explain why the change is necessary, not only what files changed.
- Call out migrations, new environment variables, security implications, and
  backward-compatibility constraints.
- Include screenshots for visible UI changes.
- Keep generated files in the same commit as the source change that generated
  them.

By contributing, you agree that your contributions are licensed under the
repository's MIT License.
