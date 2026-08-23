/**
 * Reset and seed commands are intentionally destructive/useful only locally.
 * These guards are the last line between a convenience command and a pasted
 * production connection string.
 */
import { describe, expect, it } from "vitest";

import {
  inspectDevelopmentDatabaseUrl,
  inspectDevelopmentRedisUrl,
  inspectDevelopmentStorage,
  isLoopbackHost,
} from "../../scripts/lib/dev-safety.mjs";

describe("development environment safety guards", () => {
  it("recognizes loopback hosts only", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("db.internal.example.com")).toBe(false);
  });

  it("accepts only the named local PostgreSQL database", () => {
    expect(
      inspectDevelopmentDatabaseUrl(
        "postgresql://sushi:sushi@localhost:5432/sushi_dev",
        "sushi_dev",
      ),
    ).toEqual({ ok: true, reasons: [] });

    const remote = inspectDevelopmentDatabaseUrl(
      "postgresql://user:pass@db.example.com:5432/sushi_dev",
      "sushi_dev",
    );
    expect(remote.ok).toBe(false);
    expect(remote.reasons).toContain("must use a loopback host");

    const production = inspectDevelopmentDatabaseUrl(
      "postgresql://sushi:sushi@localhost:5432/sushi_prod",
      "sushi_dev",
    );
    expect(production.ok).toBe(false);
    expect(production.reasons).toContain("must name the sushi_dev database");
  });

  it("accepts only the bundled Redis endpoint", () => {
    expect(inspectDevelopmentRedisUrl("redis://localhost:6379").ok).toBe(true);
    expect(
      inspectDevelopmentRedisUrl("rediss://redis.example.com:6380").ok,
    ).toBe(false);
  });

  it("accepts only the bundled Garage bucket for destructive resets", () => {
    expect(
      inspectDevelopmentStorage({
        STORAGE_PROVIDER: "garage",
        STORAGE_ENDPOINT: "http://localhost:3900",
        STORAGE_BUCKET: "sushi-dev",
      }),
    ).toEqual({ ok: true, reasons: [] });

    expect(
      inspectDevelopmentStorage({
        STORAGE_PROVIDER: "s3",
        STORAGE_ENDPOINT: "https://s3.amazonaws.com",
        STORAGE_BUCKET: "production",
      }).ok,
    ).toBe(false);
  });
});
