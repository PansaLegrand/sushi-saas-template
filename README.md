<div align="center">

# Sushi SaaS 🍣 - a proven template saves you weeks

A production‑ready Next.js starter with auth, billing, internationalization, content, admin, and private storage.

<br/>

<p>
  <img alt="Next.js" src="public/imgs/logos/nextjs.svg" height="28" />
  &nbsp;&nbsp;
  <img alt="React" src="public/imgs/logos/react.svg" height="28" />
  &nbsp;&nbsp;
  <img alt="Tailwind CSS" src="public/imgs/logos/tailwindcss.svg" height="28" />
  &nbsp;&nbsp;
  <img alt="shadcn/ui" src="public/imgs/logos/shadcn.svg" height="28" />
  &nbsp;&nbsp;
  <img alt="Vercel" src="public/imgs/logos/vercel.svg" height="28" />
  <br/>
  <sub>Plus: Drizzle ORM, Better Auth, Stripe, next‑intl, Fumadocs & more</sub>
  <br/>
  <br/>
  <a href="https://sushi-templates.com" target="_blank" rel="noreferrer noopener" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#111;color:#fff;text-decoration:none;">Visit Website</a>
  &nbsp;&nbsp;
  <a href="https://sushi-templates.com/en/blogs/quick-start" target="_blank" rel="noreferrer noopener" style="display:inline-block;padding:10px 14px;border-radius:8px;border:1px solid #ddd;text-decoration:none;">Learn More</a>
  <br/>
  <br/>
  <a href="https://discord.gg/aACy5qNf" target="_blank" rel="noreferrer noopener" style="display:inline-block;padding:8px 12px;border-radius:8px;border:1px solid #ddd;text-decoration:none;">Join Discord</a>
  &nbsp;&nbsp;
  <a href="https://x.com/WenzhuPan" target="_blank" rel="noreferrer noopener" style="display:inline-block;padding:8px 12px;border-radius:8px;border:1px solid #ddd;text-decoration:none;">Follow on X</a>
  <br/>
</p>

</div>




## Why You Should Choose Sushi SaaS

- Start selling sooner — subscriptions, usage credits, and payments out of the box.
- Global from day one — locale‑aware routing and translated content.
- Built‑in growth loops — affiliates and referrals you can enable when ready.
- Content & SEO baked in — MDX blogs/docs with structured metadata.
- Admin and roles — sensible read, write, and owner permissions.
- Production defaults — health endpoint, environment templates, explicit migrations.

> TL;DR: Focus on your product. The template handles the boring, critical pieces.



## What You Get

- Billing & subscriptions (Stripe)
- Authentication & profiles (Better Auth)
- Internationalization (next‑intl)
- MDX content (Fumadocs)
- Separate admin app & DB-backed roles
- Private file uploads (S3‑compatible)
- Transactional emails (Resend)
- Affiliates & referrals



## Project Layout

- `src/app` — public web app, localized routes, customer APIs, content, account flows.
- `apps/admin` — independent admin app with its own routes, auth entrypoint, RBAC guard, and admin-only APIs.
- `src/db`, `src/models`, `src/services` — shared database schema, product models, and service integrations.
- `content/docs` — template documentation, served at `/docs`. Ships with the kit.
- `content/blog` — site content, served at `/blogs`. Yours, not the template's; safe to empty.
- `messages`, `src/i18n` — translation catalogs and localization.



## Run Locally

```bash
pnpm install
pnpm dev
```

Public web runs at `http://localhost:3000`.

Run the admin app separately:

```bash
pnpm dev:admin
```

Admin runs at `http://localhost:3001`. Set `NEXT_PUBLIC_ADMIN_WEB_URL=http://localhost:3001` in `.env` for local admin auth URLs.



## Content: Template Docs vs. Your Site

There are two independent Fumadocs collections, so the kit's documentation and the deploying site's marketing content never mix:

| Collection | Route | Owner |
|---|---|---|
| `content/docs` | `/docs` | The template. Hands-on guides for setting up and extending the kit. |
| `content/blog` | `/blogs` | You. Articles, SEO pages, announcements. |

`content/blog` is optional — empty it and `/blogs` renders an empty index instead of breaking. That is the supported way to strip the previous owner's content from a fresh clone.

Also site-specific, and worth replacing when you deploy your own: the `landing` and `metadata` namespaces in `messages/*.json` (hero copy, features, **showcase URLs**, footer), `src/data/pricing.ts`, `public/imgs`, and `public/robots.txt`.

Regenerate the sitemap for your own domain:

```bash
SITEMAP_BASE_URL=https://your-domain.com pnpm gen:sitemap
```

It falls back to `NEXT_PUBLIC_WEB_URL`, then `http://localhost:3000`, and covers both collections.



## Bot Protection (Cloudflare Turnstile)

Sign-in, sign-up, password reset, and verification-email endpoints are behind a Turnstile challenge, enforced server-side by the Better Auth captcha plugin. A request to any of them without a valid token is rejected before it reaches the database or the mail provider.

Set both keys in `.env`:

```bash
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-site-key
TURNSTILE_SECRET_KEY=your-secret-key
```

For local development, Cloudflare publishes test keys that always pass: site `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`. (Swap the secret for `2x0000000000000000000000000000000AA` to test the rejection path.)

**Both keys are required in production.** Startup fails with a clear error if they're missing, so a deployment cannot silently end up with no bot protection. To run without a challenge deliberately, set `NEXT_PUBLIC_CAPTCHA_ENABLED=false`.

The protected endpoint list lives in `src/lib/captcha.ts`. The admin login form is challenged too, since it uses the same `/sign-in/email` endpoint.



## Admin App

The admin console is intentionally outside the public web app. Public routes do not expose `/admin` pages or `/api/admin/*`; those live under `apps/admin`.

Admin access is controlled by `users.role`:

- `admin_ro` can read admin data.
- `admin_rw` can read admin data and perform write actions such as granting credits.

The admin app currently includes dashboard, feedbacks, reservations, affiliates, users/orders APIs, user credit summaries, and credit grants. See `apps/admin/README.md` for deployment and operational notes.



## Showcase

- DojoClip — https://dojoclip.com — Browser‑based video editing with multilingual subtitles.
- Sushi Templates — https://sushi-templates.com — Live example deployed on Vercel.



## Community

- Discord: https://discord.gg/aACy5qNf
- X (Twitter): https://x.com/WenzhuPan



## Need Help?

If you want help customizing or launching with this template (implementation, features, or advisory), I’m available for freelance/contract:

- Email: pansalegrand@gmail.com



## License

MIT — contributions welcome.
