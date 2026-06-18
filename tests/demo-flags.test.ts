import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

async function importDemoFlags() {
  vi.resetModules();
  return import("@/lib/demo-flags");
}

describe("demo feature flags", () => {
  beforeEach(() => {
    delete process.env.ENABLE_DEMO_FEATURES;
    delete process.env.ENABLE_CREDITS_PLAYGROUND;
    delete process.env.ENABLE_TEXT2VIDEO_MOCK;
    delete process.env.ENABLE_ACCOUNT_CREDIT_GRANT;
    delete process.env.RESERVATIONS_AUTO_SEED_DEMO;
    delete process.env.NEXT_PUBLIC_RESERVATIONS_AUTO_SEED_DEMO;
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps all demo helpers disabled by default", async () => {
    const flags = await importDemoFlags();

    expect(flags.areDemoFeaturesEnabled()).toBe(false);
    expect(flags.isCreditsPlaygroundEnabled()).toBe(false);
    expect(flags.isTextToVideoMockEnabled()).toBe(false);
    expect(flags.isAccountCreditGrantEnabled()).toBe(false);
    expect(flags.isReservationDemoAutoSeedEnabled()).toBe(false);
  });

  it("enables individual demo helpers only when the global demo flag is on", async () => {
    process.env.ENABLE_DEMO_FEATURES = "true";
    process.env.ENABLE_CREDITS_PLAYGROUND = "true";
    process.env.ENABLE_TEXT2VIDEO_MOCK = "true";
    process.env.ENABLE_ACCOUNT_CREDIT_GRANT = "true";
    process.env.RESERVATIONS_AUTO_SEED_DEMO = "true";

    const flags = await importDemoFlags();

    expect(flags.areDemoFeaturesEnabled()).toBe(true);
    expect(flags.isCreditsPlaygroundEnabled()).toBe(true);
    expect(flags.isTextToVideoMockEnabled()).toBe(true);
    expect(flags.isAccountCreditGrantEnabled()).toBe(true);
    expect(flags.isReservationDemoAutoSeedEnabled()).toBe(true);
  });

  it("ignores demo flags in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.ENABLE_DEMO_FEATURES = "true";
    process.env.ENABLE_CREDITS_PLAYGROUND = "true";
    process.env.ENABLE_TEXT2VIDEO_MOCK = "true";
    process.env.ENABLE_ACCOUNT_CREDIT_GRANT = "true";
    process.env.RESERVATIONS_AUTO_SEED_DEMO = "true";

    const flags = await importDemoFlags();

    expect(flags.areDemoFeaturesEnabled()).toBe(false);
    expect(flags.isCreditsPlaygroundEnabled()).toBe(false);
    expect(flags.isTextToVideoMockEnabled()).toBe(false);
    expect(flags.isAccountCreditGrantEnabled()).toBe(false);
    expect(flags.isReservationDemoAutoSeedEnabled()).toBe(false);
  });
});
