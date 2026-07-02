import { beforeEach, describe, expect, it } from "vitest";
import { requireSameOrigin } from "@/lib/origin";
import { resetEnvCacheForTests } from "@/lib/env";

describe("requireSameOrigin", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_WEB_URL;
    delete process.env.NEXT_PUBLIC_AUTH_BASE_URL;
    resetEnvCacheForTests();
  });

  it("allows requests without browser origin metadata", () => {
    const req = new Request("https://app.example.com/api/checkout", {
      method: "POST",
    });

    expect(requireSameOrigin(req)).toBeNull();
  });

  it("allows same-origin browser requests", () => {
    const req = new Request("https://app.example.com/api/checkout", {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
      },
    });

    expect(requireSameOrigin(req)).toBeNull();
  });

  it("allows the configured web origin behind a deployment proxy", () => {
    process.env.NEXT_PUBLIC_WEB_URL = "https://app.example.com";
    resetEnvCacheForTests();

    const req = new Request("https://internal.vercel.app/api/checkout", {
      method: "POST",
      headers: {
        origin: "https://app.example.com",
      },
    });

    expect(requireSameOrigin(req)).toBeNull();
  });

  it("blocks cross-site origins", async () => {
    const req = new Request("https://app.example.com/api/checkout", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
      },
    });

    const res = requireSameOrigin(req);
    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toMatchObject({
      code: -3,
      message: "invalid origin",
    });
  });

  it("blocks invalid explicit origins", async () => {
    const req = new Request("https://app.example.com/api/checkout", {
      method: "POST",
      headers: {
        origin: "null",
      },
    });

    const res = requireSameOrigin(req);
    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toMatchObject({
      code: -3,
      message: "invalid origin",
    });
  });

  it("blocks cross-site fetch metadata when origin and referer are absent", async () => {
    const req = new Request("https://app.example.com/api/checkout", {
      method: "POST",
      headers: {
        "sec-fetch-site": "cross-site",
      },
    });

    const res = requireSameOrigin(req);
    expect(res?.status).toBe(403);
    await expect(res?.json()).resolves.toMatchObject({
      code: -3,
      message: "invalid origin",
    });
  });
});
