import { describe, expect, it } from "vitest";

import {
  ALLOW_ALL,
  CONSENT_VERSION,
  DENY_ALL,
  isAllowed,
  parseConsentCookie,
  serializeConsent,
} from "@/lib/consent";

/**
 * These assert the rule that makes the banner mean anything: an absent or
 * unreadable decision is a refusal, never a permission. A regression here would
 * not break a page or fail a type check — the site would simply start loading
 * trackers again, silently, for people who never agreed.
 */
describe("consent", () => {
  describe("parseConsentCookie", () => {
    it("treats an absent cookie as no decision", () => {
      expect(parseConsentCookie(undefined)).toBeNull();
      expect(parseConsentCookie(null)).toBeNull();
      expect(parseConsentCookie("")).toBeNull();
    });

    it("treats malformed JSON as no decision", () => {
      expect(parseConsentCookie("not-json")).toBeNull();
      expect(parseConsentCookie("%7Bbroken")).toBeNull();
    });

    it("treats a non-object payload as no decision", () => {
      expect(parseConsentCookie(encodeURIComponent('"yes"'))).toBeNull();
      expect(parseConsentCookie(encodeURIComponent("null"))).toBeNull();
      expect(parseConsentCookie(encodeURIComponent("[true]"))).toBeNull();
    });

    it("discards a decision from an older consent version", () => {
      // The visitor agreed to a different set of categories than the one we
      // would now be acting on, so the old answer cannot carry over.
      const stale = encodeURIComponent(
        JSON.stringify({ v: CONSENT_VERSION - 1, analytics: true, advertising: true })
      );

      expect(parseConsentCookie(stale)).toBeNull();
    });

    it("rejects a payload missing a category", () => {
      const partial = encodeURIComponent(
        JSON.stringify({ v: CONSENT_VERSION, analytics: true })
      );

      expect(parseConsentCookie(partial)).toBeNull();
    });

    it("rejects a truthy non-boolean rather than coercing it", () => {
      // `analytics: "false"` is truthy. Coercion here would turn a refusal
      // written by an older or third-party writer into consent.
      const coercible = encodeURIComponent(
        JSON.stringify({ v: CONSENT_VERSION, analytics: "false", advertising: 1 })
      );

      expect(parseConsentCookie(coercible)).toBeNull();
    });

    it("round-trips a real decision", () => {
      const mixed = { analytics: true, advertising: false };

      expect(parseConsentCookie(serializeConsent(mixed))).toEqual(mixed);
      expect(parseConsentCookie(serializeConsent(DENY_ALL))).toEqual({
        analytics: false,
        advertising: false,
      });
      expect(parseConsentCookie(serializeConsent(ALLOW_ALL))).toEqual({
        analytics: true,
        advertising: true,
      });
    });
  });

  describe("isAllowed", () => {
    it("denies every category when there is no decision", () => {
      expect(isAllowed(null, "analytics")).toBe(false);
      expect(isAllowed(null, "advertising")).toBe(false);
    });

    it("denies a rejected category", () => {
      expect(isAllowed({ ...DENY_ALL }, "analytics")).toBe(false);
      expect(isAllowed({ ...DENY_ALL }, "advertising")).toBe(false);
    });

    it("keeps categories independent", () => {
      const analyticsOnly = { analytics: true, advertising: false };

      expect(isAllowed(analyticsOnly, "analytics")).toBe(true);
      expect(isAllowed(analyticsOnly, "advertising")).toBe(false);
    });

    it("allows only an explicitly accepted category", () => {
      expect(isAllowed({ ...ALLOW_ALL }, "analytics")).toBe(true);
      expect(isAllowed({ ...ALLOW_ALL }, "advertising")).toBe(true);
    });
  });
});
