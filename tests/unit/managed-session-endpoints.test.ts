/** Alternate SDK HTTP routes must not bypass redaction and fresh-session revocation. */
import { expect, it } from "vitest";
import { isManagedSessionEndpoint } from "@/config/auth";
it.each(["/api/auth/list-sessions", "/api/auth/revoke-session", "/api/auth/revoke-sessions/", "/api/auth/revoke-other-sessions", "/api/auth/%6cist-sessions", "/api/auth/%256cist-sessions", "/api/auth/LIST-SESSIONS"])("closes managed endpoint %s", (path) => {
  expect(isManagedSessionEndpoint(path)).toBe(true);
});
it.each(["/api/auth/get-session", "/api/auth/sign-out", "/api/auth/sign-in/email", "/api/auth/two-factor/enable"])("preserves SDK endpoint %s", (path) => {
  expect(isManagedSessionEndpoint(path)).toBe(false);
});
