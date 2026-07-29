/**
 * Authentication callbacks are browser input. A regression here turns every
 * login URL into an open redirect; over-restricting it loses checkout workspace
 * context and strands users after MFA.
 */
import { describe, expect, it } from "vitest";

import { safeAuthCallbackPath } from "@/lib/auth-callback";

describe("safeAuthCallbackPath", () => {
  it("keeps a same-site path with its query and hash", () => {
    expect(
      safeAuthCallbackPath("/pricing?org=team-workspace#plans"),
    ).toBe("/pricing?org=team-workspace#plans");
  });

  it("rejects absolute, protocol-relative, and backslash redirects", () => {
    expect(safeAuthCallbackPath("https://evil.example/collect")).toBeNull();
    expect(safeAuthCallbackPath("//evil.example/collect")).toBeNull();
    expect(safeAuthCallbackPath("/\\evil.example/collect")).toBeNull();
  });
});
