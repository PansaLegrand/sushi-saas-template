/** Every settings entry authenticates before accessing or mutating account data. */
import { beforeEach, expect, it, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), settings: vi.fn(), name: vi.fn(), revoke: vi.fn(), latest: vi.fn() }));
vi.mock("@/services/account-lifecycle", () => ({ getAccountActorFromHeaders: mocks.actor, getLatestAccountExport: mocks.latest, requestAccountDataExport: vi.fn(), validateAccountLifecycleIdempotencyKey: vi.fn() }));
vi.mock("@/services/account-settings", () => ({ getAccountSettings: mocks.settings, updateAccountName: mocks.name, revokeAccountSessions: mocks.revoke }));
vi.mock("@/services/authz", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/services/user", () => ({ getUserProfileByUuid: vi.fn() }));
import { GET as settings } from "@/app/api/account/settings/route";
import { GET as latest } from "@/app/api/account/data-export/route";
import { PATCH as name } from "@/app/api/account/profile/route";
import { DELETE as revoke } from "@/app/api/account/sessions/route";
const actor = { userId: "u", userUuid: "uuid" };
function request(path: string, method: string, body?: unknown, origin = "http://localhost:3000") { return new Request(`http://localhost:3000/api/account/${path}`, { method, headers: { origin, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); }
beforeEach(() => { vi.resetAllMocks(); resetRateLimitForTests(); mocks.actor.mockResolvedValue(actor); mocks.settings.mockResolvedValue({ name: "Alice" }); mocks.name.mockResolvedValue({ name: "Alice" }); });
it.each([{ handler: settings, path: "settings", method: "GET" }, { handler: latest, path: "data-export", method: "GET" }, { handler: name, path: "profile", method: "PATCH" }, { handler: revoke, path: "sessions", method: "DELETE" }])("authenticates $method $path before data access", async ({ handler, path, method }) => {
  mocks.actor.mockResolvedValue(null);
  expect((await handler(request(path, method))).status).toBe(401);
  for (const call of [mocks.settings, mocks.name, mocks.revoke, mocks.latest]) expect(call).not.toHaveBeenCalled();
});
it("rejects foreign-origin writes before identity or data access", async () => {
  expect((await name(request("profile", "PATCH", { name: "Alice" }, "https://foreign.example"))).status).toBe(403);
  expect(mocks.actor).not.toHaveBeenCalled();
});
it("forwards only the allowed profile field", async () => {
  expect((await name(request("profile", "PATCH", { name: " Alice ", role: "admin_rw" }))).status).toBe(200);
  expect(mocks.name).toHaveBeenCalledWith(actor, expect.any(Headers), "Alice");
});
it("does not accept a session token as a revocation reference", async () => {
  expect((await revoke(request("sessions", "DELETE", { scope: "session", token: "secret" }))).status).toBe(400);
  expect(mocks.revoke).not.toHaveBeenCalled();
});
