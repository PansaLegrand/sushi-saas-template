/**
 * Response security headers, shared by the public app and `apps/admin`.
 *
 * ── Why this file is CommonJS JavaScript in a TypeScript repo ──────────────
 * Both `next.config.ts` files import it, and Next compiles a config to
 * `next.config.compiled.js`, inlining only imports that live *inside that
 * config's own project root*. `apps/admin` has its own root, so
 * `../../src/config/security-headers` survives as a bare `require()` — which
 * needs a real, requireable `.js` file on disk. A `.ts` module resolves fine
 * for the root app and fails the admin build with MODULE_NOT_FOUND.
 *
 * Types are carried in JSDoc instead, and `tests/unit/security-headers.test.ts`
 * covers the behaviour.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The content security policy ships in **report-only** mode by default. An
 * enforced CSP that is wrong takes the site down in a way that only appears in
 * production, and this kit cannot know which object-storage host, image CDN, or
 * support widget a given deployment adds. Report-only collects the real
 * violations first; `CSP_MODE=enforce` turns it on once the reports are quiet.
 *
 * Vendor hosts are added only when that vendor is actually configured, so a
 * deployment without analytics gets a correspondingly tighter policy.
 */

/** @typedef {"report-only" | "enforce"} CspMode */

/**
 * @typedef {"default-src"|"script-src"|"style-src"|"img-src"|"font-src"|"connect-src"|"frame-src"|"media-src"|"worker-src"|"manifest-src"} CspDirective
 */

/**
 * @typedef {object} BuildOptions
 * @property {boolean} [isProduction] Defaults to `NODE_ENV === "production"`.
 * @property {CspMode} [mode] Defaults to `process.env.CSP_MODE`, else report-only.
 * @property {string} [analyticsId] Google Analytics measurement id, when configured.
 * @property {string} [adsenseCode] AdSense publisher code, when configured.
 * @property {string} [turnstileSiteKey] Turnstile site key, when configured.
 * @property {string} [reportUri] Where violation reports are POSTed.
 * @property {Partial<Record<CspDirective, string[]>>} [extra] Extra sources per
 *   directive, for whatever this deployment adds — an S3 or R2 bucket, a support
 *   widget, an image CDN. This is the seam that stops anyone from loosening the
 *   base policy to fit one host.
 */

/**
 * @typedef {object} HeaderEntry
 * @property {string} key
 * @property {string} value
 */

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function dedupe(values) {
  return [...new Set(values)];
}

/**
 * @param {BuildOptions} [options]
 * @returns {string}
 */
function buildContentSecurityPolicy(options = {}) {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";
  const analyticsId = options.analyticsId ?? process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID;
  const adsenseCode = options.adsenseCode ?? process.env.NEXT_PUBLIC_GOOGLE_ADCODE;
  const turnstileSiteKey =
    options.turnstileSiteKey ?? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const reportUri = options.reportUri ?? process.env.CSP_REPORT_URI;

  const script = ["'self'", "'unsafe-inline'"];
  const connect = ["'self'"];
  const img = ["'self'", "data:", "blob:"];
  const frame = ["'self'"];

  // Next's development bundler evaluates code from strings. Required in dev,
  // and deliberately absent in production.
  if (!isProduction) {
    script.push("'unsafe-eval'");
    // The dev server's HMR socket.
    connect.push("ws:", "wss:");
  }

  if (analyticsId) {
    script.push("https://www.googletagmanager.com");
    connect.push(
      "https://www.google-analytics.com",
      "https://www.googletagmanager.com",
      "https://analytics.google.com"
    );
    img.push("https://www.google-analytics.com", "https://www.googletagmanager.com");
  }

  if (adsenseCode) {
    script.push(
      "https://pagead2.googlesyndication.com",
      "https://partner.googleadservices.com",
      "https://tpc.googlesyndication.com"
    );
    frame.push("https://googleads.g.doubleclick.net", "https://tpc.googlesyndication.com");
    connect.push("https://pagead2.googlesyndication.com");
  }

  if (turnstileSiteKey) {
    script.push("https://challenges.cloudflare.com");
    frame.push("https://challenges.cloudflare.com");
  }

  /** @type {Record<CspDirective, string[]>} */
  const directives = {
    "default-src": ["'self'"],
    "script-src": script,
    // Next and Tailwind both emit inline style attributes. Removing this needs
    // a nonce threaded through the document, which is a separate change.
    "style-src": ["'self'", "'unsafe-inline'"],
    // `https:` covers presigned object-storage URLs, whose host is deployment
    // specific. Narrow it to your bucket once you know it.
    "img-src": [...img, "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connect,
    "frame-src": frame,
    "media-src": ["'self'", "blob:", "https:"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };

  for (const [directive, sources] of Object.entries(options.extra ?? {})) {
    if (!sources || sources.length === 0) continue;
    const key = /** @type {CspDirective} */ (directive);
    directives[key] = [...directives[key], ...sources];
  }

  const parts = Object.entries(directives).map(
    ([directive, sources]) => `${directive} ${dedupe(sources).join(" ")}`
  );

  // Sourceless directives. `frame-ancestors` is the modern clickjacking
  // control; `X-Frame-Options` below is kept for older user agents.
  parts.push("base-uri 'self'");
  parts.push("object-src 'none'");
  parts.push("frame-ancestors 'none'");
  parts.push("form-action 'self'");

  if (isProduction) {
    parts.push("upgrade-insecure-requests");
  }

  if (reportUri) {
    parts.push(`report-uri ${reportUri}`);
  }

  return parts.join("; ");
}

/**
 * @param {CspMode} [mode]
 * @returns {CspMode}
 */
function resolveCspMode(mode) {
  const raw = mode ?? process.env.CSP_MODE;
  return raw === "enforce" ? "enforce" : "report-only";
}

/**
 * The header set applied to every response.
 *
 * HSTS is production-only. Browsers ignore it over plain HTTP, but a developer
 * running local TLS would otherwise pin `localhost` for two years.
 *
 * @param {BuildOptions} [options]
 * @returns {HeaderEntry[]}
 */
function buildSecurityHeaders(options = {}) {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === "production";
  const mode = resolveCspMode(options.mode);

  /** @type {HeaderEntry[]} */
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      // Features this product does not use. Denying them means a dependency
      // cannot quietly start using one either.
      value: [
        "accelerometer=()",
        "camera=()",
        "geolocation=()",
        "gyroscope=()",
        "magnetometer=()",
        "microphone=()",
        "payment=()",
        "usb=()",
        "interest-cohort=()",
      ].join(", "),
    },
    {
      key:
        mode === "enforce"
          ? "Content-Security-Policy"
          : "Content-Security-Policy-Report-Only",
      value: buildContentSecurityPolicy(options),
    },
  ];

  if (isProduction) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }

  return headers;
}

/**
 * Ready to spread into a Next.js `headers()` result.
 *
 * @param {BuildOptions} [options]
 */
function securityHeadersRoute(options = {}) {
  return {
    source: "/:path*",
    headers: buildSecurityHeaders(options),
  };
}

module.exports = {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  resolveCspMode,
  securityHeadersRoute,
};
