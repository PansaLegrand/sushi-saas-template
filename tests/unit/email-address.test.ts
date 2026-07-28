/**
 * Email normalization is the whole blocklist.
 *
 * A rule that compares raw input blocks exactly one spelling of an address, and
 * the abuser's first move is a second spelling. Every case below is a bypass
 * that worked before the corresponding line existed — which is why they are
 * asserted here rather than left to the database tier, where a single failure
 * would say "no match" without saying which rule stopped matching.
 */
import { describe, expect, it } from "vitest";

import {
  normalizeEmail,
  normalizeEmailDomain,
  parseEmail,
} from "@/lib/email-address";

describe("normalizeEmail", () => {
  it("lowercases the whole address", () => {
    expect(normalizeEmail("Ann.Smith@Example.COM")).toBe("ann.smith@example.com");
  });

  it("trims surrounding whitespace from a paste", () => {
    expect(normalizeEmail("  ann@example.com \n")).toBe("ann@example.com");
  });

  it("collapses plus-aliases onto one key", () => {
    // The bypass this exists for: one keystroke produces an unlimited supply of
    // addresses that all deliver to the same mailbox.
    const canonical = normalizeEmail("ann@example.com");

    expect(normalizeEmail("ann+1@example.com")).toBe(canonical);
    expect(normalizeEmail("ann+signup-2026@example.com")).toBe(canonical);
    expect(normalizeEmail("ann+++@example.com")).toBe(canonical);
  });

  it("strips dots for Gmail and only for Gmail", () => {
    // Gmail ignores dots; almost nobody else does. Applying this everywhere
    // would collapse strangers onto one key and block the wrong people.
    expect(normalizeEmail("a.n.n@gmail.com")).toBe("ann@gmail.com");
    expect(normalizeEmail("a.n.n@example.com")).toBe("a.n.n@example.com");
  });

  it("treats googlemail as gmail", () => {
    expect(normalizeEmail("ann@googlemail.com")).toBe("ann@gmail.com");
  });

  it("applies both Gmail rules together", () => {
    expect(normalizeEmail("A.N.N+throwaway@GoogleMail.com")).toBe("ann@gmail.com");
  });

  it("splits on the last @, not the first", () => {
    // A quoted local part may legally contain one; the domain never can.
    expect(normalizeEmail('"weird@local"@example.com')).toBe(
      '"weird@local"@example.com'
    );
  });

  it("refuses input that has no mailbox left to key on", () => {
    // An empty key is a blocklist row that matches every address on earth.
    expect(normalizeEmail("+tag@example.com")).toBeNull();
    expect(normalizeEmail("...@gmail.com")).toBeNull();
  });

  it("refuses anything that is not an address", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail("not-an-address")).toBeNull();
    expect(normalizeEmail("@example.com")).toBeNull();
    expect(normalizeEmail("ann@")).toBeNull();
    // No dot in the host: treating this as blockable would let one entry cover
    // a whole class of internal addresses.
    expect(normalizeEmail("ann@localhost")).toBeNull();
    expect(normalizeEmail("ann smith@example.com")).toBeNull();
  });
});

describe("normalizeEmailDomain", () => {
  it("accepts a bare host", () => {
    expect(normalizeEmailDomain("Example.COM")).toBe("example.com");
  });

  it("accepts a full address and keeps only the host", () => {
    // An admin pasting from a signup log has whichever one was in front of them.
    expect(normalizeEmailDomain("ann+1@Example.com")).toBe("example.com");
  });

  it("canonicalizes Gmail's alias domain", () => {
    expect(normalizeEmailDomain("googlemail.com")).toBe("gmail.com");
  });

  it("refuses a host that could never be an email domain", () => {
    expect(normalizeEmailDomain("localhost")).toBeNull();
    expect(normalizeEmailDomain(".example.com")).toBeNull();
    expect(normalizeEmailDomain("example.com.")).toBeNull();
    expect(normalizeEmailDomain("example com")).toBeNull();
    expect(normalizeEmailDomain("https://example.com/path")).toBeNull();
    expect(normalizeEmailDomain("")).toBeNull();
    expect(normalizeEmailDomain(null)).toBeNull();
  });
});

describe("parseEmail", () => {
  it("returns the halves already lowercased", () => {
    expect(parseEmail("Ann@Example.com")).toEqual({
      local: "ann",
      domain: "example.com",
    });
  });

  it("returns null rather than guessing at a half-address", () => {
    // The caller's signal to reject. Guessing here would mint a key that
    // matches nothing and looks active in the console.
    expect(parseEmail("ann")).toBeNull();
    expect(parseEmail("@example.com")).toBeNull();
  });
});
