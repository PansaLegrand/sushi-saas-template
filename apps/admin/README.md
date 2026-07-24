# Admin App

The admin console is a separate Next.js app so public web routes and admin-only operational routes can deploy independently. The public web app does not own `/admin` pages or `/api/admin/*`; this app owns the admin UI, admin auth entrypoint, RBAC guard, and admin-only APIs.

## Commands

- `pnpm dev:admin` runs the admin app on port `3001`.
- `pnpm build:admin` builds only the admin app.
- `pnpm start:admin` starts the built admin app on port `3001`.

## Environment

Set `NEXT_PUBLIC_ADMIN_WEB_URL` to the admin origin for local and production admin deployments.

For local development:

```bash
NEXT_PUBLIC_ADMIN_WEB_URL=http://localhost:3001
```

When that value exists, this app points Better Auth at the admin origin unless `BETTER_AUTH_URL` or `NEXT_PUBLIC_AUTH_BASE_URL` are explicitly provided by the shell/deployment environment.

## Access Control

Admin roles are stored in `users.role`:

- `admin_ro` can read admin data.
- `admin_rw` can read admin data and perform write actions.

The admin guard lives in `apps/admin/lib/authz.ts` and loads the current role from the database. Do not trust role values from the client.

Admin sign-in goes through the same `/sign-in/email` endpoint as the public app, so the Cloudflare Turnstile challenge applies here too. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` must be set for this app as well, or admin login will be rejected with `Missing CAPTCHA response`.

The role is resolved strictly from the session's user uuid or id. It is never resolved by email: `users.email` is only unique per `signin_provider`, so an email lookup can return a different account than the session's.

## Audit Trail

Every admin write action must be recorded via `writeAdminAuditLog()` in `apps/admin/lib/audit.ts`, which appends to the `admin_audit_logs` table. Entries capture the actor, action, target, note, IP, user agent, and a metadata blob, and are readable at `/audit`. The helper never throws, so a logging failure cannot mask the action's result.

Write actions must also be idempotent. `POST /api/admin/credits/grant` requires an `idempotencyKey` per attempt and derives a deterministic `credits.trans_no` from it, so a retry or double-click cannot credit twice.

## Boundary

Admin-specific code should stay in this app:

- Admin RBAC: `apps/admin/lib/authz.ts`
- Admin-only data queries: `apps/admin/lib/data.ts`
- Admin audit trail: `apps/admin/lib/audit.ts`
- Admin origin checks: `apps/admin/lib/origin.ts` (delegates to `src/lib/origin.ts` with the public web origin excluded)
- Admin response headers: `apps/admin/middleware.ts`
- Admin UI: `apps/admin/app/(admin)`
- Admin APIs: `apps/admin/app/api/admin`

Shared auth, database schema, product models, and service integrations stay in `src/`.

## Current Surfaces

- `/` dashboard with latest users, paid orders, and credit tools.
- `/feedbacks`
- `/reservations`
- `/affiliates`
- `/audit`
- `/api/admin/users`
- `/api/admin/orders`
- `/api/admin/users/[uuid]/credits`
- `/api/admin/credits/grant`
- `/api/auth/[...all]`

## Production Notes

- Deploy this app as a separate service or project from the public web app.
- Use a dedicated admin origin, for example `https://admin.example.com`.
- Set `NEXT_PUBLIC_ADMIN_WEB_URL` to that origin.
- Keep `DATABASE_URL`, `BETTER_AUTH_SECRET`, and other shared secrets aligned with the public web app.
- Assign `admin_ro` or `admin_rw` manually in the database for trusted operators.
- Keep new admin write actions behind `requireAdminWrite()` and same-origin protection, and record them with `writeAdminAuditLog()`.
- Set `ADMIN_MAX_CREDIT_GRANT` to a sane ceiling for your product (defaults to 100000).
- `apps/admin/middleware.ts` sends `noindex` and `no-store` on every admin response; keep the RBAC gate in the layout and route handlers rather than moving it into middleware.
