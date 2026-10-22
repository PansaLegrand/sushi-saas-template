/** Account settings may expose metadata, never session credentials or another user's sessions. */
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), sessions: vi.fn(), hasPassword: vi.fn(), providers: vi.fn(), update: vi.fn(), revoke: vi.fn(), revokeOthers: vi.fn(), event: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { updateUser: mocks.update, revokeSession: mocks.revoke, revokeOtherSessions: mocks.revokeOthers } } }));
vi.mock("@/models/user", () => ({ findUserById: mocks.user, updateUserLastSignin: vi.fn() }));
vi.mock("@/models/session", () => ({ listActiveAccountSessions: mocks.sessions }));
vi.mock("@/models/account", () => ({ hasPasswordCredential: mocks.hasPassword, listAccountProviders: mocks.providers }));
vi.mock("@/models/auth-event", () => ({ insertAuthEvent: mocks.event }));
import { getAccountSettings, revokeAccountSessions, updateAccountName } from "@/services/account-settings";
const actor = { userId: "internal-user", userUuid: "public-user", email: "person@example.test", lifecycleStatus: "active", sessionId: "internal-current-session", sessionCreatedAt: new Date() };
const headers = new Headers();
let sessions: { id: string; token: string; created_at: Date; expires_at: Date; user_agent: string }[];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: actor.userId, uuid: actor.userUuid, nickname: "Person", email: actor.email, email_verified: true, two_factor_enabled: false, role: "user" });
  sessions = ["internal-current-session", "internal-other-session"].map((id) => ({ id, token: `secret-${id}`, created_at: new Date(), expires_at: new Date(Date.now() + 3600_000), user_agent: "Example browser" }));
  mocks.sessions.mockImplementation(async () => sessions);
  mocks.hasPassword.mockResolvedValue(true); mocks.providers.mockResolvedValue(["credential"]);
  mocks.revoke.mockImplementation(async ({ body }) => { sessions = sessions.filter((session) => session.token !== body.token); });
});
it("projects credential-free session references and exposes MFA to ordinary users", async () => {
  const view = await getAccountSettings(actor);
  expect(view.mfaRequired).toBe(false);
  expect(view.sessions[0]).toMatchObject({ current: true, reference: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(JSON.stringify(view)).not.toContain("secret-");
  expect(JSON.stringify(view)).not.toContain("internal-");
  expect(mocks.sessions).toHaveBeenCalledWith(actor.userId);
});
it("resolves a session only within the authenticated user's list and makes replay a no-op", async () => {
  const view = await getAccountSettings(actor);
  const action = { scope: "session" as const, reference: view.sessions[1].reference };
  await revokeAccountSessions(actor, headers, action);
  await revokeAccountSessions(actor, headers, action);
  expect(mocks.revoke).toHaveBeenCalledOnce();
  expect(mocks.revoke).toHaveBeenCalledWith({ headers, body: { token: "secret-internal-other-session" } });
  expect(mocks.event).toHaveBeenCalledOnce();
});
it("does not act on unknown references or the current session", async () => {
  await revokeAccountSessions(actor, headers, { scope: "session", reference: "f".repeat(64) });
  expect(mocks.revoke).not.toHaveBeenCalled();
  const view = await getAccountSettings(actor);
  await expect(revokeAccountSessions(actor, headers, { scope: "session", reference: view.sessions[0].reference })).rejects.toMatchObject({ code: "REQUEST_INVALID" });
});
it("requires a fresh session before revocation", async () => {
  await expect(revokeAccountSessions({ ...actor, sessionCreatedAt: new Date(0) }, headers, { scope: "others" })).rejects.toMatchObject({ code: "AUTH_REAUTHENTICATION_REQUIRED" });
  expect(mocks.revokeOthers).not.toHaveBeenCalled();
  expect(mocks.sessions).not.toHaveBeenCalled();
});
it("updates only a normalized display name and records the action without the value", async () => {
  await updateAccountName(actor, headers, "  Alice  ");
  expect(mocks.update).toHaveBeenCalledWith({ headers, body: { name: "Alice" } });
  expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ event: "profile_updated", metadata: { fields: ["name"] } }));
});
