/**
 * The setup tool writes credentials before the app can validate them. These
 * tests keep profile generation idempotent and prevent development-only values
 * from leaking into a generated production profile.
 */
import { describe, expect, it } from "vitest";

import {
  formatEnvValue,
  isSetupPlaceholder,
  normalizeProfile,
  prepareAppProfile,
  prepareStudioProfile,
  readEnvValue,
  setEnvValue,
} from "../../scripts/lib/env-profile.mjs";

function deterministicSecret(encoding: "base64" | "hex") {
  return `generated-${encoding}-${"x".repeat(32)}`;
}

describe("environment profile setup", () => {
  it("accepts concise and explicit profile names", () => {
    expect(normalizeProfile("dev")).toBe("development");
    expect(normalizeProfile("local")).toBe("development");
    expect(normalizeProfile("production")).toBe("production");
    expect(normalizeProfile("preview")).toBeNull();
  });

  it("quotes values that dotenv would otherwise truncate", () => {
    expect(formatEnvValue("App #1")).toBe('"App #1"');
    expect(formatEnvValue("postgresql://localhost/app")).toBe(
      "postgresql://localhost/app",
    );
    expect(() => formatEnvValue("one\ntwo")).toThrow(/newlines/);
  });

  it("fills blank values without replacing an existing secret", () => {
    let contents = "TOKEN=already-set\nEMPTY=\n";
    contents = setEnvValue(contents, "TOKEN", "replacement", {
      overwrite: false,
    });
    contents = setEnvValue(contents, "EMPTY", "generated", {
      overwrite: false,
    });

    expect(readEnvValue(contents, "TOKEN")).toBe("already-set");
    expect(readEnvValue(contents, "EMPTY")).toBe("generated");
  });

  it("recognizes setup placeholders without treating real secrets as placeholders", () => {
    expect(
      isSetupPlaceholder("replace-with-at-least-32-random-characters"),
    ).toBe(true);
    expect(isSetupPlaceholder("change_me_before_launch")).toBe(true);
    expect(isSetupPlaceholder("real-secret-change-window-2026")).toBe(false);
  });

  it("generates a ready local profile with isolated test services", () => {
    const result = prepareAppProfile(
      "DATABASE_URL=\nTEST_DATABASE_URL=\nBETTER_AUTH_SECRET=\nCRON_SECRET=\nRATE_LIMIT_REDIS_URL=\nTEST_REDIS_URL=\n",
      "development",
      deterministicSecret,
    );

    expect(readEnvValue(result, "DATABASE_URL")).toContain("sushi_dev");
    expect(readEnvValue(result, "TEST_DATABASE_URL")).toContain("sushi_test");
    expect(readEnvValue(result, "RESTORE_DATABASE_URL")).toContain(
      "sushi_restore_drill",
    );
    expect(readEnvValue(result, "RATE_LIMIT_REDIS_URL")).toBe(
      "redis://localhost:6379",
    );
    expect(readEnvValue(result, "BETTER_AUTH_SECRET")).toMatch(/^generated-/);
    expect(readEnvValue(result, "STORAGE_PROVIDER")).toBe("garage");
    expect(readEnvValue(result, "STORAGE_ENDPOINT")).toBe(
      "http://localhost:3900",
    );
    expect(readEnvValue(result, "STORAGE_BUCKET")).toBe("sushi-dev");
  });

  it("preserves an explicitly configured external storage provider as one block", () => {
    const result = prepareAppProfile(
      [
        "STORAGE_PROVIDER=r2",
        "STORAGE_ENDPOINT=https://account.r2.cloudflarestorage.com",
        "STORAGE_REGION=auto",
        "STORAGE_ACCESS_KEY=external-access",
        "STORAGE_SECRET_KEY=external-secret",
        "STORAGE_BUCKET=external-bucket",
      ].join("\n"),
      "development",
      deterministicSecret,
    );

    expect(readEnvValue(result, "STORAGE_PROVIDER")).toBe("r2");
    expect(readEnvValue(result, "STORAGE_BUCKET")).toBe("external-bucket");
  });

  it("removes test and demo switches from production on every run", () => {
    const result = prepareAppProfile(
      [
        "DATABASE_URL=postgresql://managed/prod",
        "BETTER_AUTH_SECRET=keep-this-production-secret-unchanged",
        "TEST_DATABASE_URL=postgresql://managed/prod-test",
        "RESTORE_DATABASE_URL=postgresql://managed/prod-restore",
        "TEST_REDIS_URL=redis://managed",
        "ENABLE_DEMO_FEATURES=true",
        "AUTH_DEV_EMAIL_LINKS=true",
      ].join("\n"),
      "production",
      deterministicSecret,
    );

    expect(readEnvValue(result, "DATABASE_URL")).toBe(
      "postgresql://managed/prod",
    );
    expect(readEnvValue(result, "BETTER_AUTH_SECRET")).toBe(
      "keep-this-production-secret-unchanged",
    );
    expect(readEnvValue(result, "TEST_DATABASE_URL")).toBe("");
    expect(readEnvValue(result, "RESTORE_DATABASE_URL")).toBe("");
    expect(readEnvValue(result, "TEST_REDIS_URL")).toBe("");
    expect(readEnvValue(result, "ENABLE_DEMO_FEATURES")).toBe("false");
    expect(readEnvValue(result, "AUTH_DEV_EMAIL_LINKS")).toBe("false");
  });

  it("gives Content Studio its own local database and session secret", () => {
    const result = prepareStudioProfile(
      "CONTENT_DATABASE_URL=\nPAYLOAD_SECRET=replace-with-at-least-32-random-characters\n",
      "development",
      deterministicSecret,
    );

    expect(readEnvValue(result, "CONTENT_DATABASE_URL")).toContain(
      "sushi_content",
    );
    expect(readEnvValue(result, "PAYLOAD_SECRET")).toMatch(/^generated-/);
  });
});
