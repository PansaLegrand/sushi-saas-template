import "server-only";

import { ApiResponseCode } from "@/types/api";
import type { Logger } from "@/lib/logger/types";
import { logger as baseLogger } from "@/lib/logger/server";

import { AppError, toAppError } from "./app-error";
import { type ErrorCode, getErrorDefinition } from "./catalog";

/**
 * The wire shape for a failed request.
 *
 * Extends the existing `{ code, message, data }` envelope rather than replacing
 * it: `code` stays a number so existing clients and route tests keep working,
 * and `error_code` is the new stable key the frontend branches on. Adding a
 * field is backward compatible; changing the envelope would not be.
 */
export type ApiErrorBody = {
  code: ApiResponseCode;
  /** English fallback from the catalog. Clients prefer their own translation. */
  message: string;
  /** Stable machine key. The only field safe to branch on. */
  error_code: ErrorCode;
  /** Structured, user-safe context — e.g. which fields failed validation. */
  details?: unknown;
};

/** Maps a status onto the legacy numeric code so old clients still work. */
function numericCodeFor(status: number): ApiResponseCode {
  switch (status) {
    case 401:
      return ApiResponseCode.Unauthorized;
    case 403:
      return ApiResponseCode.Forbidden;
    case 404:
      return ApiResponseCode.NotFound;
    default:
      return ApiResponseCode.Error;
  }
}

export type RespErrorOptions = {
  /** Logger to use; falls back to the base logger. Pass the route's child. */
  log?: Logger;
  /** Extra fields for the log line only. Never sent to the client. */
  logFields?: Record<string, unknown>;
  /** Code to use when the error carries none. */
  fallback?: ErrorCode;
};

/**
 * Turn any thrown value into a safe HTTP response, and log the real one.
 *
 * This is the single boundary where server internals stop. The body is built
 * from the catalog entry for the resolved code — never from `error.message` —
 * so there is no code path that can put a Stripe payload, a SQL fragment, or a
 * stack trace in front of a user. `tests/unit/errors.response.test.ts` asserts
 * that property directly.
 *
 *   } catch (error) {
 *     return respError(error, { log, fallback: "ORDER_CREATE_FAILED" });
 *   }
 */
export function respError(error: unknown, options: RespErrorOptions = {}): Response {
  const appError = toAppError(error, options.fallback);
  const definition = getErrorDefinition(appError.code);
  const log = options.log ?? baseLogger;

  // Full detail goes here and only here.
  const logPayload = {
    ...options.logFields,
    event: "api.error",
    error_code: appError.code,
    status: appError.statusCode,
    // The developer-facing message, which is what we refuse to send onward.
    detail: appError.message,
    cause:
      appError.cause instanceof Error
        ? { name: appError.cause.name, message: appError.cause.message }
        : appError.cause,
  };

  // 5xx means we broke something; 4xx means the caller did. Different urgency,
  // so different level — a wall of error logs for ordinary validation failures
  // trains everyone to ignore the channel.
  if (appError.statusCode >= 500) {
    log.error(logPayload);
  } else {
    log.warn(logPayload);
  }

  const body: ApiErrorBody = {
    code: numericCodeFor(appError.statusCode),
    message: definition.defaultMessage,
    error_code: appError.code,
  };

  if (appError.details !== undefined) {
    body.details = appError.details;
  }

  return Response.json(body, { status: appError.statusCode });
}

/**
 * Shorthand for a known failure with no exception in hand.
 *
 *   if (!prompt) return respCode("TASK_PROMPT_REQUIRED");
 */
export function respCode(
  code: ErrorCode,
  options: RespErrorOptions & { message?: string; details?: unknown } = {}
): Response {
  return respError(
    new AppError(code, { message: options.message, details: options.details }),
    options
  );
}
