# Admin App

The admin console is a separate Next.js app so public web routes and admin-only operational routes can deploy independently.

- `pnpm dev:admin` runs the admin app on port `3001`.
- `pnpm build:admin` builds only the admin app.
- `pnpm start:admin` starts the built admin app on port `3001`.

Shared auth, database, models, and services stay in `src/`. Admin UI and admin API routes live here.

Set `NEXT_PUBLIC_ADMIN_WEB_URL` to the admin origin for local and production admin deployments. When that value exists, this app points Better Auth at the admin origin unless `BETTER_AUTH_URL` or `NEXT_PUBLIC_AUTH_BASE_URL` are explicitly provided by the shell/deployment environment.
