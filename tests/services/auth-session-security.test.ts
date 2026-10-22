/** Session assurance must never be inferred from a caller-controlled account flag. */
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), mark: vi.fn(), clear: vi.fn() }));
vi.mock("@/models/user", () => ({ findUserById: mocks.user }));
vi.mock("@/models/session", () => ({ markSessionMfaVerified: mocks.mark, clearSessionMfaVerification: mocks.clear }));
import { invalidateSessionMfaVerification, recordSessionMfaVerification } from "@/services/auth-session-security";
beforeEach(() => vi.resetAllMocks());
it("requires persisted enrollment and writes only the verified session identity", async () => {
  mocks.user.mockResolvedValue(undefined);
  await recordSessionMfaVerification("u", "s");
  mocks.user.mockResolvedValue({ two_factor_enabled: false });
  await recordSessionMfaVerification("u", "s");
  expect(mocks.mark).not.toHaveBeenCalled();
  mocks.user.mockResolvedValue({ two_factor_enabled: true });
  await recordSessionMfaVerification("u", "s");
  expect(mocks.mark).toHaveBeenCalledWith("u", "s");
});
it("invalidates assurance for the account and propagates persistence failure", async () => {
  mocks.clear.mockRejectedValue(new Error("unavailable"));
  await expect(invalidateSessionMfaVerification("u")).rejects.toThrow("unavailable");
  expect(mocks.clear).toHaveBeenCalledWith("u");
});
