# SaaS Sushi 🍣

Open-source SaaS starter kit — pick your components like plates on a conveyor belt and roll a product fast.


---


## Why SaaS Sushi?
- Modular by design so you can start productive, then mix in features when you actually need them.
- Clean defaults with strict TypeScript, consistent UI primitives, and sensible project structure.
- Production-ready tracks for auth, billing, database, emails, and deployment that work together out of the box.
- AI-ready integrations (OpenAI, DeepSeek, Replicate, etc.) already wired through the `ai` SDK helpers.

---

## Features – Pick Your Plates
- Auth: Auth.js (email magic link, OAuth providers, credentials) with RBAC roles.
- Billing: Stripe subscriptions, one-time payments, and customer portal flows.
- Database: Drizzle ORM + Postgres schema, migrations, and seed scripts.
- CRUD: Example entities with list/detail/edit pages, typed API routes, and Zod validation.
- UI: Tailwind + Radix UI powered components, theming, and dark mode ready.
- Email: Resend (or SMTP) for onboarding, receipts, and notifications.
- Storage: S3-compatible uploads from server or edge handlers.
- Analytics: Privacy-friendly page + event tracking options (PostHog, Umami, etc.).
- Docs: Built-in docs site powered by Fumadocs MDX with full-text search.
- Deploy: One-click Vercel preset or Docker images plus Cloudflare/Fly presets.

---

## Tech Stack
- Frontend: Next.js (App Router), React 19, TypeScript, Tailwind CSS, Radix UI primitives.
- Backend: Next.js route handlers (REST) with optional streaming AI endpoints and Zod validation.
- Data: Drizzle ORM, Postgres (Neon, Supabase, or local Docker).
- Auth: Auth.js (NextAuth v5) adapters wired into Drizzle models.
- Payments: Stripe subscriptions, metered usage ready, and customer portal integration.
- Email & Notifications: Resend with SMTP fallback.
- QA: ESLint, TypeScript, Vitest/Playwright scaffolds (optional) with GitHub Actions pipelines.

---

## Project Structure
```
saas-sushi-template/
├─ src/
│  ├─ app/             # Next.js App Router routes, layouts, APIs, and theming
│  ├─ components/      # UI building blocks (Tailwind + Radix wrappers)
│  ├─ contexts/        # React providers for global state
│  ├─ db/              # Drizzle config, schema, migrations
│  ├─ i18n/            # Localization dictionaries and routing helpers
│  ├─ integrations/    # External provider helpers (Stripe, AI SDKs, etc.)
│  ├─ lib/             # Shared utilities and server helpers
│  ├─ providers/       # App-level providers (theme, auth, analytics)
│  └─ services/        # Domain logic, webhooks, background helpers
├─ content/            # MDX docs surfaced via Fumadocs
├─ public/             # Static assets (hero, logos, OG images)
├─ components.json     # MDX component registry for docs/editor
├─ package.json        # Scripts and dependencies
└─ README.md
```
Prefer a single-app layout? Stick to `src/app` and ignore workspace packages—SaaS Sushi supports both mono and single app flows.

---


## Quick Start

---

## What You Get Out of the Box
- Landing, auth, and dashboard starter pages wired to role-based navigation.
- Protected routes, RBAC helpers, and session-aware UI states.
- Sample CRUD for an `Item` model with list/create/update/delete flows.
- Stripe webhook wiring with local tunnel recipe and billing portal examples.
- Typed forms powered by React Hook Form + Zod, plus accessible UI primitives.
- AI chat playground and templated flows ready for provider keys.


---


## Credits & Inspiration
- Next.js, Auth.js, Drizzle ORM, Stripe, Tailwind CSS, Radix UI, Zod, Vercel.
- Huge thanks to the open-source SaaS template community for patterns and prior art.

