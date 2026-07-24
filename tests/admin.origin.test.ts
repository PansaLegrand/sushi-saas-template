/**
 * The admin same-origin guard must be strictly narrower than the web app's.
 *
 * On an `admin.` subdomain the public site is same-*site*, so SameSite=Lax does
 * not stop it from sending admin session cookies. This check is what keeps the
 * two apps isolated.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { requireSameOrigin } from "@admin/lib/origin";
import { resetEnvCacheForTests } from "@/lib/env";

describe("admin requireSameOrigin", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_WEB_URL;
    delete process.env.NEXT_PUBLIC_ADMIN_WEB_URL;
    resetEnvCacheForTests();
  });

  it("allows same-origin admin requests", () => {
    const req = new Request("https://admin.example.com/api/admin/credits/grant", {
      method: "POST",
      headers: { origin: "https://admin.example.com" },
    });

    expect(requireSameOrigin(req)).toBeNull();
  });

  it("allows the configured admin origin behind a deployment proxy", () => {
    process.env.NEXT_PUBLIC_ADMIN_WEB_URL = "https://admin.example.com";
    resetEnvCacheForTests();

    const req = new Request("https://internal.vercel.app/api/admin/credits/grant", {
      method: "POST",
      headers: { origin: "https://admin.example.com" },
    });

    expect(requireSameOrigin(req)).toBeNull();
  });

  it("blocks the public web origin even though it is same-site", async () => {
    process.env.NEXT_PUBLIC_WEB_URL = "https://example.com";
    process.env.NEXT_PUBLIC_ADMIN_WEB_URL = "https://admin.example.com";
    resetEnvCacheForTests();

    const req = new Request("https://admin.example.com/api/admin/credits/grant", {
      method: "POST",
      headers: { origin: "https://example.com" },
    });

    const res = requireSameOrigin(req);
    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toMatchObject({
      message: "invalid origin",
    });
  });

  it("blocks malformed origin headers", () => {
    const req = new Request("https://admin.example.com/api/admin/credits/grant", {
      method: "POST",
      headers: { origin: "null" },
    });

    expect(requireSameOrigin(req)?.status).toBe(403);
  });

  it("blocks cross-site fetch metadata when origin and referer are absent", () => {
    const req = new Request("https://admin.example.com/api/admin/credits/grant", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    });

    expect(requireSameOrigin(req)?.status).toBe(403);
  });
});
