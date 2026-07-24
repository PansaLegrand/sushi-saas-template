/**
 * The no-leak guarantee.
 *
 * This file exists because `respErr("checkout failed: " + e.message)` shipped raw
 * Stripe and Postgres text to users. The point of respError is that no code path
 * can do that again, and the only way to keep that true is to assert it against
 * the nastiest payloads we can think of.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError, toAppError } from "@/lib/errors/app-error";
import { respCode, respError } from "@/lib/errors/response";
import { getErrorDefinition } from "@/lib/errors/catalog";

const log = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
};
log.child.mockReturnValue(log);

/** Strings that must never appear in a response body. */
const SECRETS = [
  "postgresql://postgres:hunter2@db.internal:5432/app",
  "sk_live_51H8xQ2abcdef",
  'insert into "credits" ("trans_no") values ($1)',
  "at PostgresJsPreparedQuery.queryWithCache (/app/node_modules/drizzle-orm/…)",
  "constraint_name: credits_trans_no_unique",
];

describe("respError", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the catalog message, never the developer message", async () => {
    const error = new AppError("CREDITS_INSUFFICIENT", {
      message: "user u-123 has 4 credits, needed 50",
    });

    const res = await respError(error, { log }).json();

    expect(res.error_code).toBe("CREDITS_INSUFFICIENT");
    expect(res.message).toBe(getErrorDefinition("CREDITS_INSUFFICIENT").defaultMessage);
    expect(JSON.stringify(res)).not.toContain("u-123");
  });

  it.each(SECRETS)("keeps %s out of the response body", async (secret) => {
    const res = await respError(new Error(secret), { log });
    const body = JSON.stringify(await res.json());

    expect(body).not.toContain(secret);
    expect(res.status).toBe(500);
  });

  it("still logs the detail it refuses to send", async () => {
    const secret = "sk_live_51H8xQ2abcdef";
    await respError(new Error(secret), { log });

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.error.mock.calls[0][0])).toContain(secret);
  });

  it("labels an unrecognized throw as a server error", async () => {
    const res = await respError(new Error("Connection terminated unexpectedly"), { log });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error_code).toBe("SERVER_ERROR");
  });

  it("maps a legacy throw onto its catalog code", async () => {
    // Routes not yet migrated still `throw new Error("insufficient credits")`.
    const res = await respError(new Error("insufficient credits"), { log });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error_code).toBe("CREDITS_INSUFFICIENT");
  });

  it("uses the caller's fallback only when the error carries no code", async () => {
    const unknown = await respError(new Error("boom"), { log, fallback: "TASK_CREATE_FAILED" });
    expect((await unknown.json()).error_code).toBe("TASK_CREATE_FAILED");

    const known = await respError(new AppError("AUTH_REQUIRED"), {
      log,
      fallback: "TASK_CREATE_FAILED",
    });
    expect((await known.json()).error_code).toBe("AUTH_REQUIRED");
  });

  it("keeps the legacy numeric code so existing clients still work", async () => {
    expect((await (await respError(new AppError("AUTH_REQUIRED"), { log })).json()).code).toBe(-2);
    expect((await (await respError(new AppError("AUTH_FORBIDDEN"), { log })).json()).code).toBe(-3);
    expect((await (await respError(new AppError("RESOURCE_NOT_FOUND"), { log })).json()).code).toBe(-4);
    expect((await (await respError(new AppError("REQUEST_INVALID"), { log })).json()).code).toBe(-1);
  });

  it("logs 4xx at warn and 5xx at error", async () => {
    await respError(new AppError("REQUEST_INVALID"), { log });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();

    vi.clearAllMocks();

    await respError(new AppError("SERVER_ERROR"), { log });
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("passes structured details through, since they are built to be safe", async () => {
    const res = await respCode("REQUEST_VALIDATION_FAILED", {
      log,
      details: [{ field: "email", message: "Enter a valid email address." }],
    });
    const body = await res.json();

    expect(body.details).toEqual([
      { field: "email", message: "Enter a valid email address." },
    ]);
  });

  it("omits details entirely when there are none", async () => {
    const body = await (await respError(new AppError("AUTH_REQUIRED"), { log })).json();
    expect("details" in body).toBe(false);
  });
});

describe("toAppError", () => {
  it("returns an AppError unchanged", () => {
    const original = new AppError("TASK_NOT_FOUND");
    expect(toAppError(original)).toBe(original);
  });

  it("preserves the original as cause for the log trail", () => {
    const cause = new Error("ECONNREFUSED 10.0.0.5:5432");
    expect(toAppError(cause).cause).toBe(cause);
  });

  it("reads a code off an error that carries one", () => {
    const error = Object.assign(new Error("nope"), { code: "AUTH_FORBIDDEN" });
    expect(toAppError(error).code).toBe("AUTH_FORBIDDEN");
  });

  it("handles a thrown string", () => {
    expect(toAppError("insufficient credits").code).toBe("CREDITS_INSUFFICIENT");
  });
});
