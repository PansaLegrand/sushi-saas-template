# Security headers

Both apps set a baseline of response security headers from one module,
`src/config/security-headers.js`, applied through each app's
`next.config.ts` `headers()`.

The content security policy ships in **report-only** mode. Everything else is
enforced from the start, because nothing else in the set can break a page.

## What is set

| Header | Value | Notes |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | |
| `X-Frame-Options` | `DENY` | For user agents predating `frame-ancestors`. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `apps/admin` overrides to `same-origin`. |
| `Permissions-Policy` | camera, microphone, geolocation, payment, USB, … all `()` | Denies features the product does not use, so a dependency cannot quietly start using one. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | **Production only.** |
| `Content-Security-Policy-Report-Only` | see below | Becomes `Content-Security-Policy` when `CSP_MODE=enforce`. |

HSTS is production-only on purpose. Browsers ignore it over plain HTTP, but a
developer running local TLS would otherwise pin `localhost` for two years.

## The policy

Sourceless directives are always on: `base-uri 'self'`, `object-src 'none'`,
`frame-ancestors 'none'`, `form-action 'self'`, plus
`upgrade-insecure-requests` in production.

Two directives are looser than ideal, both with a reason:

- **`script-src 'unsafe-inline'`** — Next emits inline bootstrap scripts.
  Removing this needs a nonce threaded from middleware through the document,
  which is its own change.
- **`style-src 'unsafe-inline'`** — Next and Tailwind both emit inline style
  attributes. Same story.

`'unsafe-eval'` and `ws:`/`wss:` are added **in development only**, for the dev
bundler and its hot-reload socket. Production gets neither.

### Vendor hosts are conditional

Google Analytics, AdSense, and Turnstile hosts are added only when that vendor's
env var is set. A deployment with no analytics gets a correspondingly tighter
policy, and `apps/admin` — which runs neither — gets the tightest one for free.

This is also why the consent work matters here: the tags only load after a
visitor opts in, so a policy written against a freshly loaded page has not yet
seen every host it will eventually need. Report-only surfaces those instead of
blocking them.

## Moving to enforce

1. Set `CSP_REPORT_URI` so violations go somewhere you will actually read.
2. Deploy, and leave it for a full traffic cycle — including someone accepting
   analytics cookies, an upload, and a checkout round trip.
3. For each violation, decide: add the host through `extra`, or remove whatever
   is pulling it in. Do not loosen a base directive to fit one host.
4. Set `CSP_MODE=enforce`.

### Adding a deployment-specific host

Pass `extra` from your app's `next.config.ts` rather than editing the base
policy:

```ts
securityHeadersRoute({
  extra: {
    "connect-src": ["https://your-bucket.r2.cloudflarestorage.com"],
    "img-src": ["https://your-cdn.example.com"],
  },
});
```

`img-src` and `media-src` already include `https:` because presigned
object-storage URLs are deployment specific. Narrow those to your bucket once
you know it.

## Two layers in `apps/admin`

The admin console sets headers in both `next.config.ts` and `middleware.ts`:

- The config supplies the shared baseline, including the full report-only CSP.
- The middleware adds `X-Robots-Tag`, `Cache-Control: no-store`, a stricter
  `Referrer-Policy: same-origin`, and a **narrow enforced CSP**
  (`frame-ancestors`, `base-uri`, `form-action`).

That enforced policy predates the shared one and is known safe, so it stays on
while the broader policy is still collecting reports. Both CSP headers apply;
a browser enforces the intersection.

## Why the module is JavaScript

`src/config/security-headers.js` is CommonJS JavaScript in an otherwise
TypeScript repo. Next compiles each `next.config.ts` and inlines only imports
inside that config's own project root — `apps/admin` has its own root, so an
import reaching into the repo's `src/` survives as a bare `require()` that must
resolve to a real `.js` file. The admin config loads it by absolute path via
`createRequire`, the same way it already resolves the repo's `.env` files.

Types are carried in JSDoc, and `tests/unit/security-headers.test.ts` covers the
behaviour.
