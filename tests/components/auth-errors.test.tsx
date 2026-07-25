/**
 * Better Auth's strings must never reach the screen.
 *
 * The sign-in forms used to render `error.message` straight from the library:
 * English-only, and worded by a dependency we do not control. `resolveAuthError`
 * is the seam that stops that, so these tests pin both halves — known failures
 * get real copy, unknown ones get the generic message rather than passthrough.
 */
import { describe, expect, it } from "vitest";

import { resolveAuthError } from "@/lib/errors/auth-client";

describe("resolveAuthError", () => {
  it("maps Better Auth's code to catalogued copy", () => {
    expect(resolveAuthError({ code: "INVALID_EMAIL_OR_PASSWORD" })).toMatch(
      /do not match/i
    );
  });

  it("falls back to the message for plugin errors that ship no code", () => {
    // The captcha plugin reports this way.
    expect(resolveAuthError({ message: "Captcha verification failed" })).toMatch(
      /verification failed/i
    );
  });

  it("translates rather than echoing English", () => {
    const fr = resolveAuthError({ code: "USER_ALREADY_EXISTS" }, "fr");
    expect(fr).toMatch(/existe déjà/i);
  });

  it("never passes an unrecognized message through to the user", () => {
    const leaked = "connect ECONNREFUSED 10.0.0.4:5432";
    const shown = resolveAuthError({ message: leaked });

    expect(shown).not.toContain("ECONNREFUSED");
    expect(shown).not.toContain("10.0.0.4");
  });

  it("handles a null error, which is how the catch branch calls it", () => {
    expect(resolveAuthError(null)).toBeTruthy();
    expect(resolveAuthError(undefined, "ja")).toBeTruthy();
  });
});
