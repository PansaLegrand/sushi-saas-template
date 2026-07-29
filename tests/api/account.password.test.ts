/**
 * Setting a first password on a provider-only account.
 *
 * This endpoint exists to open a door, so the tests are mostly about the door
 * staying narrow: it must not accept a password *change*, it must not run for a
 * signed-out caller, and it must not be the one credential endpoint in the app
 * without a rate limit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setInitialPassword: vi.fn(),
  rateLimitOrThrow: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/origin", () => ({
  requireSameOrigin: () => undefined,
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimitOrThrow: mocks.rateLimitOrThrow,
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("@/services/user", () => ({
  setInitialPassword: mocks.setInitialPassword,
}));

import { POST as setPassword } from "@/app/api/account/password/route";
import { respCode } from "@/lib/errors/response";

function request(body: unknown) {
  return new Request("http://localhost:3000/api/account/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/account/password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimitOrThrow.mockResolvedValue(undefined);
    mocks.headers.mockResolvedValue(new Headers());
    mocks.setInitialPassword.mockResolvedValue({ status: "ok" });
  });

  it("sets the password for a signed-in provider-only account", async () => {
    const res = await setPassword(request({ newPassword: "a-good-password" }));

    expect(res.status).toBe(200);
    expect(mocks.setInitialPassword).toHaveBeenCalledWith(
      expect.any(Headers),
      "a-good-password",
    );
  });

  it("refuses a signed-out caller", async () => {
    mocks.setInitialPassword.mockResolvedValue({ status: "unauthenticated" });

    const res = await setPassword(request({ newPassword: "a-good-password" }));

    expect(res.status).toBe(401);
  });

  it("refuses to overwrite a password that already exists", async () => {
    // The security boundary. Rotating a known password goes through
    // `changePassword`, which re-authenticates; if this endpoint accepted it, a
    // stolen session could replace a real password with no check at all.
    mocks.setInitialPassword.mockResolvedValue({ status: "already-set" });

    const res = await setPassword(request({ newPassword: "a-good-password" }));
    const payload = await res.json();

    expect(res.status).toBe(409);
    expect(payload.error_code).toBe("AUTH_PASSWORD_ALREADY_SET");
  });

  it("rejects a password below the minimum", async () => {
    const res = await setPassword(request({ newPassword: "short" }));

    expect(res.status).toBe(400);
    expect(mocks.setInitialPassword).not.toHaveBeenCalled();
  });

  it("rejects a missing password", async () => {
    const res = await setPassword(request({}));

    expect(res.status).toBe(400);
    expect(mocks.setInitialPassword).not.toHaveBeenCalled();
  });

  it("is rate limited on the security-sensitive auth bucket", async () => {
    // A credential-setting endpoint throttled alongside ordinary API traffic is
    // one an attacker can hammer at API speed.
    mocks.rateLimitOrThrow.mockResolvedValue(respCode("REQUEST_RATE_LIMITED"));

    const res = await setPassword(request({ newPassword: "a-good-password" }));

    expect(res.status).toBe(429);
    expect(mocks.rateLimitOrThrow).toHaveBeenCalledWith(
      expect.anything(),
      "auth-sensitive",
    );
    expect(mocks.setInitialPassword).not.toHaveBeenCalled();
  });
});
