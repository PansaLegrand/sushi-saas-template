/** Alternate SDK HTTP routes must not bypass redaction and fresh-session revocation. */
import { expect, it } from "vitest";
import { isManagedOrganizationEndpoint, isManagedSessionEndpoint } from "@/config/auth";
it.each(["/api/auth/list-sessions", "/api/auth/revoke-session", "/api/auth/revoke-sessions/", "/api/auth/revoke-other-sessions", "/api/auth/%6cist-sessions", "/api/auth/%256cist-sessions", "/api/auth/LIST-SESSIONS"])("closes managed endpoint %s", (path) => {
  expect(isManagedSessionEndpoint(path)).toBe(true);
});
it.each(["invite-member", "accept-invitation", "reject-invitation", "cancel-invitation", "add-member", "remove-member", "update-member-role", "leave"])("closes direct organization mutation %s", (endpoint) => {
  for (const prefix of ["/api/auth", "/api/auth/"]) {
    expect(isManagedOrganizationEndpoint(`${prefix}/organization/${endpoint}`)).toBe(true);
  }
  expect(isManagedOrganizationEndpoint(`/api/auth/organization/${endpoint.toUpperCase()}/`)).toBe(true);
  expect(isManagedOrganizationEndpoint(`/api/auth/%256frganization/${endpoint}`)).toBe(true);
});
it.each(["/api/auth/organization/list", "/api/auth/organization/set-active", "/api/auth/sign-in/email", "/api/auth/callback/google"])("preserves supported SDK endpoint %s", (path) => {
  expect(isManagedOrganizationEndpoint(path)).toBe(false);
});
it.each(["/api/auth/get-session", "/api/auth/sign-out", "/api/auth/sign-in/email", "/api/auth/two-factor/enable"])("preserves SDK endpoint %s", (path) => {
  expect(isManagedSessionEndpoint(path)).toBe(false);
});
