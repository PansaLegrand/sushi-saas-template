/**
 * Logger redaction is the final boundary before diagnostics leave the process.
 * These tests prevent nested SDK errors and credentials embedded in strings
 * from bypassing the shallower path rules provided by the logger backend.
 */
import { describe, expect, it } from "vitest";

import {
  redactLogFields,
  redactLogString,
} from "@/lib/logger/redact";

describe("logger redaction", () => {
  it("redacts sensitive keys at any nesting depth", () => {
    expect(
      redactLogFields({
        request: {
          provider: {
            credentials: {
              refresh_token: "refresh-value",
              harmless: "kept",
            },
          },
        },
      })
    ).toEqual({
      request: {
        provider: {
          credentials: "[REDACTED]",
        },
      },
    });
  });

  it("redacts configured secrets and credentials embedded in messages", () => {
    const secret = "database-password";
    const result = redactLogString(
      `failed postgresql://app:${secret}@db.internal/x with Bearer abc.def and sk_live_123456`,
      [secret]
    );

    expect(result).not.toContain(secret);
    expect(result).not.toContain("abc.def");
    expect(result).not.toContain("sk_live_123456");
    expect(result).toContain("[REDACTED]");
  });

  it("serializes errors safely and tolerates circular diagnostic objects", () => {
    const cause = new Error("provider rejected whsec_very-secret");
    Object.assign(cause, { accessToken: "provider-token" });
    const fields: Record<string, unknown> = { cause };
    fields.self = fields;

    const result = redactLogFields(fields) as {
      cause: { message: string; accessToken: string };
      self: string;
    };

    expect(result.cause.message).not.toContain("whsec_very-secret");
    expect(result.cause.accessToken).toBe("[REDACTED]");
    expect(result.self).toBe("[Circular]");
  });
});
