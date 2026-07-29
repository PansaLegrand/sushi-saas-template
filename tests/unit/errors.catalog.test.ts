/**
 * Guards the catalog's internal consistency.
 *
 * Without these, the failure mode is a user staring at `TASK_PROVIDER_FAILED`
 * because someone added a code and forgot four locale files — and nobody notices
 * until a non-English user hits that path in production.
 */
import { describe, expect, it } from "vitest";

import {
  ERROR_CATALOG,
  ERROR_CODES,
  getErrorDefinition,
  inferErrorCodeFromStatus,
  normalizeErrorCode,
} from "@/lib/errors/catalog";
import { getErrorTranslationBundles, translateErrorCode } from "@/lib/errors/i18n";
import { resolveAuthError } from "@/lib/errors/auth-client";

describe("error catalog", () => {
  it("gives every code a plausible HTTP status", () => {
    for (const code of ERROR_CODES) {
      const { statusCode } = getErrorDefinition(code);
      expect(statusCode, code).toBeGreaterThanOrEqual(400);
      expect(statusCode, code).toBeLessThan(600);
    }
  });

  it("gives every code a non-empty English fallback", () => {
    for (const code of ERROR_CODES) {
      expect(getErrorDefinition(code).defaultMessage.trim(), code).not.toBe("");
    }
  });

  it("never maps one legacy alias to two codes", () => {
    // A duplicated alias would resolve by catalog declaration order, making the
    // mapping depend on where someone happened to paste the entry.
    const seen = new Map<string, string>();

    for (const code of ERROR_CODES) {
      for (const legacy of getErrorDefinition(code).legacyCodes ?? []) {
        const key = legacy.toLowerCase();
        expect(seen.has(key), `"${legacy}" claimed by ${seen.get(key)} and ${code}`).toBe(
          false
        );
        seen.set(key, code);
      }
    }
  });

  it("does not let a legacy alias shadow a canonical code", () => {
    for (const code of ERROR_CODES) {
      for (const legacy of getErrorDefinition(code).legacyCodes ?? []) {
        expect(ERROR_CODES).not.toContain(legacy);
      }
    }
  });
});

describe("normalizeErrorCode", () => {
  it("passes canonical codes through", () => {
    expect(normalizeErrorCode("CREDITS_INSUFFICIENT")).toBe("CREDITS_INSUFFICIENT");
  });

  it("maps the legacy strings the app used to throw", () => {
    expect(normalizeErrorCode("insufficient credits")).toBe("CREDITS_INSUFFICIENT");
    expect(normalizeErrorCode("invalid params")).toBe("REQUEST_INVALID");
    expect(normalizeErrorCode("Email not verified")).toBe("AUTH_EMAIL_NOT_VERIFIED");
    expect(normalizeErrorCode("no auth, please sign-in")).toBe("AUTH_REQUIRED");
  });

  it("maps Better Auth's re-authentication failures", () => {
    // Regression. Both of these were uncatalogued, so `resolveAuthError` fell
    // through to SERVER_ERROR and the two-factor setup form told the user
    // "something went wrong on our end, please try again" — for a wrong
    // password, and for an account that has no password to get right. Retrying
    // helps with neither, so the message sent people down a dead end.
    expect(normalizeErrorCode("INVALID_PASSWORD")).toBe("AUTH_INVALID_PASSWORD");
    expect(normalizeErrorCode("Invalid password")).toBe("AUTH_INVALID_PASSWORD");
    expect(normalizeErrorCode("CREDENTIAL_ACCOUNT_NOT_FOUND")).toBe(
      "AUTH_PASSWORD_NOT_SET"
    );
    expect(normalizeErrorCode("Credential account not found")).toBe(
      "AUTH_PASSWORD_NOT_SET"
    );

    // Asserted through the function the form actually calls, with the exact
    // payload Better Auth's client returned, so the guard covers the whole
    // chain rather than the lookup in isolation.
    expect(
      resolveAuthError({ code: "INVALID_PASSWORD", message: "Invalid password" }, "en")
    ).toBe("That password is incorrect.");
  });

  it("maps Better Auth's duplicate signup response", () => {
    expect(normalizeErrorCode("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL")).toBe(
      "AUTH_USER_ALREADY_EXISTS"
    );
    expect(
      resolveAuthError(
        {
          code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
          message: "User already exists. Use another email.",
        },
        "en"
      )
    ).toBe("An account with that email already exists.");
  });

  it("is case- and separator-insensitive", () => {
    expect(normalizeErrorCode("credits_insufficient")).toBe("CREDITS_INSUFFICIENT");
    expect(normalizeErrorCode("  INSUFFICIENT CREDITS  ")).toBe("CREDITS_INSUFFICIENT");
  });

  it("returns undefined rather than guessing", () => {
    // Callers must be able to tell "unknown" apart from a real code, so they can
    // fall back to SERVER_ERROR instead of mislabelling the failure.
    expect(normalizeErrorCode("Connection terminated unexpectedly")).toBeUndefined();
    expect(normalizeErrorCode("")).toBeUndefined();
    expect(normalizeErrorCode(undefined)).toBeUndefined();
  });
});

describe("inferErrorCodeFromStatus", () => {
  it("maps the statuses routes actually return", () => {
    expect(inferErrorCodeFromStatus(401)).toBe("AUTH_REQUIRED");
    expect(inferErrorCodeFromStatus(403)).toBe("AUTH_FORBIDDEN");
    expect(inferErrorCodeFromStatus(404)).toBe("RESOURCE_NOT_FOUND");
    expect(inferErrorCodeFromStatus(429)).toBe("REQUEST_RATE_LIMITED");
  });

  it("treats anything 5xx as a server error", () => {
    expect(inferErrorCodeFromStatus(500)).toBe("SERVER_ERROR");
    expect(inferErrorCodeFromStatus(502)).toBe("SERVER_ERROR");
  });
});

describe("error translations", () => {
  const bundles = getErrorTranslationBundles();
  const locales = Object.keys(bundles) as (keyof typeof bundles)[];

  it("covers all five app locales", () => {
    expect(locales.sort()).toEqual(["en", "es", "fr", "ja", "zh"]);
  });

  it.each(locales)("%s translates every catalog code", (locale) => {
    const missing = ERROR_CODES.filter((code) => !bundles[locale][code]);
    expect(missing, `missing in ${locale}`).toEqual([]);
  });

  it.each(locales)("%s has no keys that left the catalog", (locale) => {
    const orphaned = Object.keys(bundles[locale]).filter(
      (key) => !(key in ERROR_CATALOG)
    );
    expect(orphaned, `orphaned in ${locale}`).toEqual([]);
  });

  it("matches the catalog's English fallbacks exactly", () => {
    // Two sources of English would drift, and the one users see would silently
    // diverge from the one in the logs.
    for (const code of ERROR_CODES) {
      expect(bundles.en[code], code).toBe(getErrorDefinition(code).defaultMessage);
    }
  });

  it("translates a legacy alias, not just a canonical code", () => {
    expect(translateErrorCode("insufficient credits", "zh")).toBe(
      bundles.zh.CREDITS_INSUFFICIENT
    );
  });

  it("falls back through locale, then English, then the code itself", () => {
    expect(translateErrorCode("AUTH_REQUIRED", "zh")).toBe(bundles.zh.AUTH_REQUIRED);
    expect(translateErrorCode("AUTH_REQUIRED", "de")).toBe(bundles.en.AUTH_REQUIRED);
    expect(translateErrorCode("AUTH_REQUIRED", "zh-CN")).toBe(bundles.zh.AUTH_REQUIRED);
    // A visible code beats an empty string: it reads as a bug report.
    expect(translateErrorCode("NOT_A_REAL_CODE", "en")).toBe("NOT_A_REAL_CODE");
  });
});
