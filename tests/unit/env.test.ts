import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "NODE_ENV",
  "npm_lifecycle_event",
  "NEXT_PHASE",
  "NEXT_PUBLIC_WEB_URL",
  "NEXT_PUBLIC_ADMIN_WEB_URL",
  "BETTER_AUTH_URL",
  "NEXT_PUBLIC_AUTH_BASE_URL",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "AUTH_SECRET",
  "STRIPE_PRIVATE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "STORAGE_BUCKET",
  "S3_BUCKET",
  "STORAGE_ACCESS_KEY",
  "S3_ACCESS_KEY_ID",
  "STORAGE_SECRET_KEY",
  "S3_SECRET_ACCESS_KEY",
  "ENABLE_DEMO_FEATURES",
  "ENABLE_CREDITS_PLAYGROUND",
  "ENABLE_TEXT2VIDEO_MOCK",
  "STORAGE_MAX_UPLOAD_MB",
  "NEXT_PUBLIC_UPLOAD_MAX_MB",
  "STORAGE_ENDPOINT",
  "S3_ENDPOINT",
  "LOG_LEVEL",
  "NEXT_PUBLIC_CAPTCHA_ENABLED",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "NEXT_PUBLIC_SITE_MODE",
];

async function loadEnvModule() {
  vi.resetModules();
  const mod = await import("@/lib/env");
  mod.resetEnvCacheForTests();
  return mod;
}

function setProductionEnv() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_WEB_URL", "https://example.com");
  vi.stubEnv("BETTER_AUTH_URL", "https://example.com");
  vi.stubEnv("NEXT_PUBLIC_AUTH_BASE_URL", "https://example.com");
  vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/app");
  vi.stubEnv("BETTER_AUTH_SECRET", "secret");
  vi.stubEnv("STRIPE_PRIVATE_KEY", "sk_live_test");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "App <app@example.com>");
  vi.stubEnv("STORAGE_BUCKET", "bucket");
  vi.stubEnv("STORAGE_ACCESS_KEY", "access");
  vi.stubEnv("STORAGE_SECRET_KEY", "secret");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key");
}

describe("typed environment validation", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses local defaults outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");

    const { validateAppEnv } = await loadEnvModule();
    const env = validateAppEnv();

    expect(env.NEXT_PUBLIC_WEB_URL).toBe("http://localhost:3000");
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(env.NEXT_PUBLIC_AUTH_BASE_URL).toBe("http://localhost:3000");
    expect(env.NEXT_PUBLIC_AUTH_ENABLED).toBe(true);
    expect(env.STORAGE_MAX_UPLOAD_MB).toBe(25);
    expect(env.ENABLE_DEMO_FEATURES).toBe(false);
  });

  it("fails clearly when production secrets are missing", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { EnvValidationError, validateAppEnv } = await loadEnvModule();

    expect(() => validateAppEnv()).toThrow(EnvValidationError);
    try {
      validateAppEnv();
    } catch (error) {
      expect((error as Error).message).toContain("Missing required production");
      expect((error as any).issues).toEqual(
        expect.arrayContaining([
          "NEXT_PUBLIC_WEB_URL",
          "DATABASE_URL",
          "BETTER_AUTH_SECRET (or AUTH_SECRET)",
          "STRIPE_PRIVATE_KEY",
          "STORAGE_BUCKET (or S3_BUCKET)",
        ])
      );
    }
  });

  it("needs nothing but a URL in site mode", async () => {
    // The headline claim of `site` mode: the marketing and docs deployment runs
    // with no Postgres, no auth secret, and no payment keys. If this test ever
    // fails, the site can no longer be deployed without provisioning a database
    // it never reads.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_MODE", "site");
    vi.stubEnv("NEXT_PUBLIC_WEB_URL", "https://example.com");

    const { validateAppEnv } = await loadEnvModule();
    const env = validateAppEnv();

    expect(env.NEXT_PUBLIC_SITE_MODE).toBe("site");
  });

  it("still demands a URL in site mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_MODE", "site");

    const { EnvValidationError, validateAppEnv } = await loadEnvModule();

    expect(() => validateAppEnv()).toThrow(EnvValidationError);
  });

  it("defaults to app mode, which keeps every requirement", async () => {
    // A deployment that forgets to set the variable must get the strict
    // contract, not the permissive one.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_WEB_URL", "https://example.com");

    const { validateAppEnv } = await loadEnvModule();

    try {
      validateAppEnv();
      throw new Error("expected validation to fail");
    } catch (error) {
      expect((error as any).issues).toEqual(
        expect.arrayContaining(["DATABASE_URL", "STRIPE_PRIVATE_KEY"])
      );
    }
  });

  it("accepts required production env and normalizes values", async () => {
    setProductionEnv();
    vi.stubEnv("ENABLE_DEMO_FEATURES", "yes");
    vi.stubEnv("ENABLE_TEXT2VIDEO_MOCK", "on");
    vi.stubEnv("STORAGE_PROVIDER", "R2");
    vi.stubEnv("STORAGE_MAX_UPLOAD_MB", "50");

    const { validateAppEnv } = await loadEnvModule();
    const env = validateAppEnv();

    expect(env.NEXT_PUBLIC_WEB_URL).toBe("https://example.com");
    expect(env.STORAGE_PROVIDER).toBe("r2");
    expect(env.STORAGE_MAX_UPLOAD_MB).toBe(50);
    expect(env.ENABLE_DEMO_FEATURES).toBe(true);
    expect(env.ENABLE_TEXT2VIDEO_MOCK).toBe(true);
  });

  it("supports legacy S3 aliases for storage credentials", async () => {
    setProductionEnv();
    delete process.env.STORAGE_BUCKET;
    delete process.env.STORAGE_ACCESS_KEY;
    delete process.env.STORAGE_SECRET_KEY;
    vi.stubEnv("S3_BUCKET", "alias-bucket");
    vi.stubEnv("S3_ACCESS_KEY_ID", "alias-access");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "alias-secret");

    const { validateAppEnv } = await loadEnvModule();
    const env = validateAppEnv();

    expect(env.STORAGE_BUCKET).toBe("alias-bucket");
    expect(env.STORAGE_ACCESS_KEY).toBe("alias-access");
    expect(env.STORAGE_SECRET_KEY).toBe("alias-secret");
  });

  it("requires turnstile keys in production by default", async () => {
    setProductionEnv();
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;

    const { EnvValidationError, validateAppEnv } = await loadEnvModule();

    expect(() => validateAppEnv()).toThrow(EnvValidationError);
    try {
      validateAppEnv();
    } catch (error) {
      expect((error as any).issues).toEqual(
        expect.arrayContaining([
          "TURNSTILE_SECRET_KEY",
          "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
        ])
      );
    }
  });

  it("allows an explicit captcha opt-out in production", async () => {
    setProductionEnv();
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    vi.stubEnv("NEXT_PUBLIC_CAPTCHA_ENABLED", "false");

    const { validateAppEnv } = await loadEnvModule();
    const env = validateAppEnv();

    expect(env.NEXT_PUBLIC_CAPTCHA_ENABLED).toBe(false);
  });

  it("tolerates whitespace around boolean env values", async () => {
    // Hosting dashboards routinely store a pasted value with a trailing
    // space or newline; that must not fail the build.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_CAPTCHA_ENABLED", " false\n");
    vi.stubEnv("ENABLE_DEMO_FEATURES", "  TRUE  ");

    const { validateAppEnv } = await loadEnvModule();
    const env = validateAppEnv();

    expect(env.NEXT_PUBLIC_CAPTCHA_ENABLED).toBe(false);
    expect(env.ENABLE_DEMO_FEATURES).toBe(true);
  });

  it("names the offending value when a boolean env var is unparseable", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_CAPTCHA_ENABLED", "enabled");

    const { EnvValidationError, validateAppEnv } = await loadEnvModule();

    expect(() => validateAppEnv()).toThrow(EnvValidationError);
    try {
      validateAppEnv();
    } catch (error) {
      expect((error as Error).message).toContain('Received "enabled"');
    }
  });

  it("validates URL-shaped env vars", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_WEB_URL", "not a url");

    const { EnvValidationError, validateAppEnv } = await loadEnvModule();

    expect(() => validateAppEnv()).toThrow(EnvValidationError);
  });

  it("does not require production secrets during build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("npm_lifecycle_event", "build:admin");

    const { validateAppEnv } = await loadEnvModule();

    expect(validateAppEnv().NEXT_PUBLIC_WEB_URL).toBe("http://localhost:3000");
  });
});
