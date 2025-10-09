# Sushi SaaS 🍣

Build and launch your SaaS faster — production‑ready starter with i18n, auth, billing, credits, affiliates, MDX docs, and admin tools.

**Languages**: English | [Français](./README.fr.md) | [Español](./README.es.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)

**Why Sushi SaaS**

- Revenue‑ready: Stripe Checkout + credit ledger for usage‑based products.
- Auth that lasts: Better Auth + Postgres via Drizzle (typed, migratable).
- Global from day one: next‑intl routing and localized content.
- Growth loops: affiliates + referrals with configurable rewards.
- Content & SEO: MDX blogs with frontmatter → metadata + JSON‑LD.
- Admin & RBAC: server‑guarded admin with read‑only/read‑write roles.
- Solid DX: pnpm, Turbopack/Webpack toggle, typed configs, ESLint/Tailwind.
- Ops‑friendly: health endpoint, environment templates, explicit migrations.

---

## Showcase

- DojoClip — https://dojoclip.com — Browser‑based video editing with laser‑focused multilingual subtitles.

- Sushi Templates — https://sushi-templates.com — See how this site looks when deployed on Vercel.

---

## Contact

I build and ship production SaaS applications. If you want help customizing or launching with this template (implementation, features, or advisory), I’m available for freelance/contract.

- Languages: English, French, Chinese
- Email: pansalegrand@gmail.com

---

## Contributor Guide

New contributors should review [Repository Guidelines](./AGENTS.md) for project structure, workflows, and review expectations before making changes.

---

## Quick Start

Prerequisites: Node 20+, pnpm 9+

```bash
pnpm install
pnpm dev
```

Open:

- Landing: `/en`, `/zh`, `/es`, `/fr`, `/ja`
- Health: `/api/health`
- Docs example: `/:locale/blogs/quick-start`
- Credit sandbox: `/:locale/credits-test`
 - Files page: `/:locale/account/files` (private uploads)

### Demo: Reservations (modular feature)

This template includes an optional reservations feature to demonstrate a mini product flow (availability + deposit checkout + webhook confirmation) in a modular way.

- Toggle on/off with `NEXT_PUBLIC_FEATURE_RESERVATIONS_ENABLED`.
- UI at `/:locale/reserve` (e.g., `/en/reserve`).
- After payment, the webhook confirms the reservation and sends an email (Resend) with an ICS calendar file.
- View bookings at `/:locale/account/reservations`.

Setup

1) Configure env vars: `STRIPE_PRIVATE_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_WEB_URL`.
2) Generate and run DB migrations:

   pnpm drizzle-kit generate --config src/db/config.ts
   pnpm drizzle-kit migrate --config src/db/config.ts

3) Start dev server:

   pnpm dev

4) Test webhooks locally with Stripe CLI:

   stripe listen --forward-to localhost:3000/api/pay/webhook/stripe

---

## Project Structure

```
src/
├─ app/
│  ├─ [locale]/
│  │  ├─ page.tsx           # Landing page (i18n)
│  │  └─ (seo)/blogs/       # MDX docs/blogs (Fumadocs)
│  │     ├─ [[...slug]]/page.tsx
│  │     └─ layout.tsx
│  ├─ api/
│  │  ├─ health/route.ts    # Health endpoint
│  │  └─ auth/[...all]/route.ts # Better Auth handler
│  ├─ globals.css           # Tailwind + theme
│  └─ layout.tsx            # Root layout
├─ i18n/
│  ├─ locale.ts             # locales, defaultLocale, prefix
│  ├─ request.ts            # next-intl request config
│  ├─ routing.ts            # next-intl routing helper
│  └─ navigation.ts         # locale-aware Link/router
├─ lib/
│  ├─ auth.ts               # Better Auth server config
│  └─ utils.ts              # small helpers
├─ services/
│  └─ storage/              # S3-compatible storage adapter (S3/R2/MinIO)
│     ├─ adapter.ts         # interface + config helpers
│     ├─ s3.ts              # implementation using AWS SDK v3
│     └─ index.ts           # provider selector
├─ models/
│  └─ file.ts               # CRUD for files table
├─ providers/
│  ├─ theme.tsx             # theme + Toaster + global providers
│  ├─ google-analytics.tsx  # GA injection (prod only)
│  └─ affiliate-init.tsx    # one-shot client hook to finalize attribution
└─ contexts/
   └─ app.tsx               # app-level provider (placeholder)

content/
└─ docs/<locale>/...        # MDX content (served at /:locale/blogs/...)

messages/
└─ <locale>.json            # landing + metadata translations
```

---

## Internationalization

This templated app uses next‑intl v4.

- Static routing config comes from `src/i18n/locale.ts`.
- Runtime message loading is in `src/i18n/request.ts`.
- Middleware is in `src/middleware.ts` (prefixed routes). We use `localePrefix: "always"` so `/en` and `/zh` etc. are explicit.
- Messages live in `messages/*.json`.

Add a locale:

1) Create `messages/<locale>.json`
2) Add the code to `locales` in `src/i18n/locale.ts`
3) Optionally add localized MDX pages under `content/docs/<locale>`
4) Restart dev

---

## Docs & MDX (Fumadocs)

- Content lives at `content/docs/<locale>/...`
- Routes are available at `/:locale/blogs/<slugs>`
- Dev script generates `.source/index.ts` automatically
- MDX is parsed by the Fumadocs Next plugin

Create a page:

```bash
mkdir -p content/docs/en
cat > content/docs/en/my-page.mdx <<'MDX'
---
title: My Page
---

# Hello
MDX
```

Then open `/en/blogs/my-page`.

Styling

- The blogs segment layout imports `fumadocs-ui/css/style.css` and wraps pages in `DocsLayout`.
- You can switch theme by importing a palette from `fumadocs-ui/css/*.css`.

---

## Authentication (Better Auth)

Better Auth powers both the server endpoints and the UI flows (sign-up, sign-in,
profile) in this template.

- Server config: `src/lib/auth.ts`
- Next API handler: `src/app/api/auth/[...all]/route.ts`
- Client helpers: `src/lib/auth-client.ts`
- UI routes: `/:locale/login`, `/:locale/signup`, `/:locale/me`
- Enabled endpoints: Email & Password (sessions stored in Postgres)

Environment variables:

```env
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_AUTH_BASE_URL=http://localhost:3000
```

### Database setup

Better Auth persists users, sessions, accounts, and verifications in Postgres via
Drizzle. Before testing auth, make sure:

1. `DATABASE_URL` is defined in `.env` (see `.env.example`).
2. Generate the latest SQL after schema changes:

   ```bash
   pnpm drizzle-kit generate --config src/db/config.ts
   ```

3. Apply migrations to your database:

   ```bash
   pnpm drizzle-kit migrate --config src/db/config.ts
   ```

4. Restart the dev server so Better Auth picks up the updated tables.

See `/en/blogs/database-setup` for the full guide.

---

## Affiliates & Referrals

Turn on referrals to reward users for signups and purchases.

- Share links: `/:locale/i/<inviteCode>` set a 30‑day `ref` cookie and redirect.
- Finalize attribution after login/signup via `/api/affiliate/update-invite`.
- Rewards on paid orders via `src/services/affiliate.ts` (fixed/percent/hybrid, deduped by order).
- User page: `/:locale/my-invites` shows link, summary, activity. Admin page: `/admin/affiliates`.

Configuration: `src/data/affiliate.ts`

- Program: `enabled`, `attributionWindowDays`, `allowSelfReferral`, `attributionModel`
- Rewards: `commissionMode` (fixed_only | percent_only | greater_of | sum), `signup`, `paid`
- Payout type: `payoutType = "cash"` (cents) or `"credits"` (in‑app credits)
- Share path: `sharePath` (default `/i`); base URL uses `NEXT_PUBLIC_WEB_URL`

Local test

1. Visit `/:locale/my-invites`, copy your link
2. Open in incognito, sign up, then revisit `my-invites`
3. Run a Stripe test payment; check admin page for rewards

Gotchas

- Ensure `NEXT_PUBLIC_WEB_URL` matches your local origin (e.g., `http://localhost:3000`).
- The client hook only marks success when the API returns 200; if it fires pre‑login, it will retry post‑login.

## Health Check

`GET /api/health` returns JSON with service status, timestamp, and environment. Use this for readiness probes or basic uptime checks.

---

## Scripts

- `pnpm dev` – generates MDX map and starts Next with Turbopack
- `pnpm dev:webpack` – same but using Webpack (useful if Turbopack plugins misbehave)
- `pnpm build` / `pnpm start` – production build & start

---

## Email (Resend)

This template integrates transactional email via Resend.

- Code
  - Service: `src/services/email/send.ts` (sendMail, sendWelcomeEmail, sendPaymentSuccessEmail)
  - Templates: `src/services/email/templates/*` (welcome, payment-success)
  - Triggers: welcome on user create (`src/lib/auth.ts`), payment confirmation in Stripe webhook (`src/app/api/pay/webhook/stripe/route.ts`)
- Env

```env
RESEND_API_KEY=...
EMAIL_FROM="Your Name <founder@your-domain.com>"  # use your verified domain/subdomain
```

- Notes
  - Verify your domain in Resend; prefer a subdomain like `send.your-domain.com` and copy DNS values exactly.
  - Use a friendly From name and address (avoid `no-reply@`).
  - Emails are sent in the background; webhooks are acknowledged quickly.

Read the full guide at `/en/blogs/email-service` (also available in es/fr/ja/zh).

---

## Private File Uploads (S3 / R2)

User‑private uploads backed by S3‑compatible storage. Defaults to AWS S3 and works with Cloudflare R2 or MinIO by changing env only.

- UI: `/:locale/account/files` (minimal uploader component)
- API:
  - `POST /api/storage/uploads` → presigned PUT URL + DB record (`status=uploading`)
  - `POST /api/storage/uploads/complete` → verify object; mark `status=active`
  - `GET /api/storage/files` → list user files
  - `GET /api/storage/files/[uuid]?download=1&expiresIn=3600&disposition=inline&contentType=application/octet-stream` → signed GET URL
  - `DELETE /api/storage/files/[uuid]` → soft delete + attempt object delete
- DB: `files` table (ownership, storage location, metadata, lifecycle)
- Env (see `.env.example`):

```env
STORAGE_PROVIDER=s3               # s3 | r2 | minio
STORAGE_BUCKET=your-bucket
STORAGE_REGION=us-east-1         # use auto for R2
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...
STORAGE_ENDPOINT=                # empty for AWS; R2/MinIO endpoint if used
S3_FORCE_PATH_STYLE=true         # recommended for R2/MinIO
STORAGE_MAX_UPLOAD_MB=25
NEXT_PUBLIC_UPLOAD_MAX_MB=25     # UI hint only
```

Migrations

```bash
pnpm drizzle-kit generate --config src/db/config.ts
pnpm drizzle-kit migrate --config src/db/config.ts
```

Third‑party processing

- Generate a per‑file presigned download from your server and hand it to the vendor:
  - `GET /api/storage/files/{uuid}?download=1&expiresIn=3600`
- The URL is time‑boxed and valid for that single object only.

Read the full guide at `/en/blogs/storage-uploads`.

---

## Stripe Subscriptions with Price IDs

For subscription plans, you can optionally use Stripe Price IDs instead of inline prices. This enables cleaner upgrades/downgrades, trials, and automatic credit grants on renewals.

Setup

1) In Stripe Dashboard, create Prices for your monthly/yearly plans.
2) Set the corresponding env vars in `.env.local`:

   NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_MONTHLY=price_...
   NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY=price_...
   NEXT_PUBLIC_STRIPE_PRICE_LAUNCH_YEARLY=price_...
   NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY=price_...

   Optional CNY variants are also supported (see `.env.example`).

Behavior

- Checkout uses Price IDs for subscriptions when provided (falls back to inline prices otherwise).
- Renewals (`invoice.payment_succeeded` with `billing_reason=subscription_cycle`) create a new Order and automatically grant the plan’s credits for the next period.
- Dunning emails still send on `invoice.payment_failed` and the Billing page links to the Stripe customer portal.

---

## Troubleshooting

- MDX “Unknown module type”: ensure the Fumadocs MDX plugin is active in `next.config.ts`, then restart (you should see `[MDX] types generated`).
- `/zh` shows English: verify `localePrefix = "always"` and restart; check `messages/zh.json` exists.
- Docs 404: confirm your file path under `content/docs/<locale>/...` matches the slug after `/blogs/`.


---

## License

MIT. Contributions welcome.
