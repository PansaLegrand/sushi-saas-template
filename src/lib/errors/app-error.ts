import {
  type ErrorCode,
  getErrorDefinition,
  inferErrorCodeFromStatus,
  normalizeErrorCode,
} from "./catalog";

export type AppErrorOptions = {
  /**
   * Developer-facing detail. Goes to logs. **Never** reaches the client — the
   * user-facing text always comes from the catalog. Put the useful specifics
   * here: which provider failed, which id was missing, what the SDK said.
   */
  message?: string;
  /** Structured context safe to show the user, e.g. failing field names. */
  details?: unknown;
  /** The original error, preserved for the log trail. */
  cause?: unknown;
  /** Override the catalog's status. Rarely needed. */
  statusCode?: number;
};

/**
 * The only error type server code should throw.
 *
 * The split that matters: `code` decides what the user is told (via the catalog
 * and its translations), while `message` carries the developer detail that stays
 * in the logs. There is deliberately no way to push arbitrary text to the user —
 * that is what leaked Stripe and Postgres internals through the checkout route
 * before this existed.
 *
 *   throw new AppError("CREDITS_INSUFFICIENT", {
 *     message: `user ${uuid} has ${balance}, needed ${cost}`,
 *     details: { required: cost, available: balance },
 *   });
 *
 * The user sees "You do not have enough credits for this." in their language.
 * The log line has the uuid and the numbers.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const definition = getErrorDefinition(code);

    // super(message) sets the developer-facing text. Anything user-facing is
    // resolved later from the code, so this string can be as specific as you like.
    super(options.message ?? definition.defaultMessage);

    this.name = "AppError";
    this.code = code;
    this.statusCode = options.statusCode ?? definition.statusCode;
    this.details = options.details;

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }

    // Keeps `throw new AppError(...)` stack traces pointing at the throw site
    // rather than at this constructor.
    Error.captureStackTrace?.(this, AppError);
  }

  /** The English fallback for this code. Logs and no-locale clients. */
  get publicMessage(): string {
    return getErrorDefinition(this.code).defaultMessage;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Coerce anything caught into an AppError.
 *
 * Unknown throws become `SERVER_ERROR` — a deliberate choice. An error we did
 * not anticipate is exactly the kind whose message is most likely to contain a
 * connection string or a SQL fragment, so it gets the generic public message and
 * its real text goes only to the log.
 */
export function toAppError(error: unknown, fallback: ErrorCode = "SERVER_ERROR"): AppError {
  if (isAppError(error)) return error;

  // Errors thrown as bare strings, or carrying a `code` we recognise. Covers
  // the not-yet-migrated `throw new Error("insufficient credits")` call sites.
  const candidate =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? ((error as Error & { code?: unknown }).code as string | undefined) ??
          error.message
        : undefined;

  const mapped = normalizeErrorCode(candidate);
  if (mapped) {
    return new AppError(mapped, {
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }

  return new AppError(fallback, {
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}

/** Build an AppError from an HTTP status when that is all we know. */
export function appErrorFromStatus(status: number, message?: string): AppError {
  return new AppError(inferErrorCodeFromStatus(status), { message, statusCode: status });
}
