import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  resolveCspMode,
} from "@/config/security-headers.js";

function directive(csp: string, name: string): string | undefined {
  return csp
    .split("; ")
    .find((part) => part === name || part.startsWith(`${name} `));
}

const PROD = { isProduction: true } as const;

describe("security headers", () => {
  describe("mode", () => {
    it("defaults to report-only", () => {
      // An enforced policy that is wrong takes the site down in a way that only
      // shows up in production. Opting in is the safe direction.
      expect(resolveCspMode(undefined)).toBe("report-only");
      expect(resolveCspMode("report-only")).toBe("report-only");
    });

    it("enforces only when explicitly asked", () => {
      expect(resolveCspMode("enforce")).toBe("enforce");
    });

    it("picks the header name from the mode", () => {
      const reporting = buildSecurityHeaders({ ...PROD, mode: "report-only" });
      const enforcing = buildSecurityHeaders({ ...PROD, mode: "enforce" });

      expect(reporting.map((h) => h.key)).toContain("Content-Security-Policy-Report-Only");
      expect(reporting.map((h) => h.key)).not.toContain("Content-Security-Policy");
      expect(enforcing.map((h) => h.key)).toContain("Content-Security-Policy");
      expect(enforcing.map((h) => h.key)).not.toContain(
        "Content-Security-Policy-Report-Only"
      );
    });
  });

  describe("baseline headers", () => {
    it("always sets the non-negotiable ones", () => {
      const keys = buildSecurityHeaders(PROD).map((h) => h.key);

      expect(keys).toContain("X-Content-Type-Options");
      expect(keys).toContain("X-Frame-Options");
      expect(keys).toContain("Referrer-Policy");
      expect(keys).toContain("Permissions-Policy");
    });

    it("sets HSTS in production only", () => {
      // Browsers ignore HSTS over plain HTTP, but a developer running local TLS
      // would otherwise pin localhost for two years.
      const prod = buildSecurityHeaders({ isProduction: true });
      const dev = buildSecurityHeaders({ isProduction: false });

      expect(prod.find((h) => h.key === "Strict-Transport-Security")?.value).toContain(
        "max-age=63072000"
      );
      expect(dev.find((h) => h.key === "Strict-Transport-Security")).toBeUndefined();
    });
  });

  describe("policy", () => {
    it("denies framing and object embedding outright", () => {
      const csp = buildContentSecurityPolicy(PROD);

      expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
      expect(directive(csp, "object-src")).toBe("object-src 'none'");
      expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
      expect(directive(csp, "form-action")).toBe("form-action 'self'");
    });

    it("allows eval in development only", () => {
      // Next's dev bundler evaluates code from strings; production must not.
      expect(directive(buildContentSecurityPolicy({ isProduction: false }), "script-src"))
        .toContain("'unsafe-eval'");
      expect(directive(buildContentSecurityPolicy(PROD), "script-src")).not.toContain(
        "'unsafe-eval'"
      );
    });

    it("upgrades insecure requests in production only", () => {
      expect(directive(buildContentSecurityPolicy(PROD), "upgrade-insecure-requests"))
        .toBeDefined();
      expect(
        directive(
          buildContentSecurityPolicy({ isProduction: false }),
          "upgrade-insecure-requests"
        )
      ).toBeUndefined();
    });
  });

  describe("vendor hosts", () => {
    it("omits analytics hosts when analytics is not configured", () => {
      const csp = buildContentSecurityPolicy({
        ...PROD,
        analyticsId: undefined,
        adsenseCode: undefined,
        turnstileSiteKey: undefined,
      });

      expect(csp).not.toContain("googletagmanager.com");
      expect(csp).not.toContain("google-analytics.com");
      expect(csp).not.toContain("googlesyndication.com");
      expect(csp).not.toContain("challenges.cloudflare.com");
    });

    it("adds analytics hosts only when an id is set", () => {
      const csp = buildContentSecurityPolicy({ ...PROD, analyticsId: "G-ABC123" });

      expect(directive(csp, "script-src")).toContain("https://www.googletagmanager.com");
      expect(directive(csp, "connect-src")).toContain("https://www.google-analytics.com");
      // Still nothing for vendors that remain unconfigured.
      expect(csp).not.toContain("googlesyndication.com");
    });

    it("adds turnstile to both script-src and frame-src", () => {
      // The widget loads a script and renders in an iframe; allowing only one
      // of the two produces a challenge that never appears.
      const csp = buildContentSecurityPolicy({ ...PROD, turnstileSiteKey: "0x4A" });

      expect(directive(csp, "script-src")).toContain("https://challenges.cloudflare.com");
      expect(directive(csp, "frame-src")).toContain("https://challenges.cloudflare.com");
    });
  });

  describe("extension", () => {
    it("appends deployment-specific sources without replacing the base", () => {
      const csp = buildContentSecurityPolicy({
        ...PROD,
        extra: { "connect-src": ["https://bucket.example.com"] },
      });

      const connect = directive(csp, "connect-src");
      expect(connect).toContain("'self'");
      expect(connect).toContain("https://bucket.example.com");
    });

    it("does not repeat a source already present", () => {
      const csp = buildContentSecurityPolicy({
        ...PROD,
        extra: { "connect-src": ["'self'"] },
      });

      const occurrences = directive(csp, "connect-src")!.split(" ").filter(
        (s) => s === "'self'"
      );
      expect(occurrences).toHaveLength(1);
    });
  });
});
