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
- `content/docs`, `messages`, `src/i18n` — docs/blog content and localization.



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
