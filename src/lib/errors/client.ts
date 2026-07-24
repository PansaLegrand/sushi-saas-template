import { type ErrorCode, inferErrorCodeFromStatus, normalizeErrorCode } from "./catalog";
import { translateErrorCode } from "./i18n";

/**
 * A failed API call, as the browser sees it.
 *
 * Carries the stable `code` so UI can branch (offer a top-up link on
 * CREDITS_INSUFFICIENT, a sign-in link on AUTH_REQUIRED) without matching on
 * text. `message` is the server's English fallback; call `resolveErrorMessage`
 * to get something to actually show a user.
 */
export class ClientApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(options: {
    code: ErrorCode;
    status: number;
    message?: string;
    details?: unknown;
  }) {
    super(options.message ?? options.code);
    this.name = "ClientApiError";
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
  }
}

export function isClientApiError(value: unknown): value is ClientApiError {
  return value instanceof ClientApiError;
}

/**
 * Read a non-OK Response into a ClientApiError.
 *
 * Tolerant on purpose: an HTML error page from a proxy, an empty body from a
 * gateway timeout, or a legacy `{ code: -1, message }` payload all still yield a
 * usable code, because the status alone is enough to pick one.
 */
export async function readApiError(response: Response): Promise<ClientApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  const payload = (body ?? {}) as {
    error_code?: unknown;
    message?: unknown;
    details?: unknown;
  };

  const code =
    normalizeErrorCode(
      typeof payload.error_code === "string" ? payload.error_code : undefined
    ) ??
    // Pre-migration routes send no error_code; their message may still be a
    // known legacy string like "insufficient credits".
    normalizeErrorCode(typeof payload.message === "string" ? payload.message : undefined) ??
    inferErrorCodeFromStatus(response.status);

  return new ClientApiError({
    code,
    status: response.status,
    message: typeof payload.message === "string" ? payload.message : undefined,
    details: payload.details,
  });
}

/**
 * Fetch wrapper: returns `data` on success, throws ClientApiError otherwise.
 *
 *   const summary = await parseApiResponse<CreditSummary>(
 *     await fetch("/api/account/credits", { method: "POST" })
 *   );
 */
export async function parseApiResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await readApiError(response);
  }

  const body = (await response.json()) as { code?: number; data?: T; message?: string };

  // A 200 carrying a non-zero code is the legacy failure shape — still a failure.
  if (typeof body.code === "number" && body.code !== 0) {
    throw new ClientApiError({
      code:
        normalizeErrorCode(body.message) ?? inferErrorCodeFromStatus(response.status || 400),
      status: response.status,
      message: body.message,
    });
  }

  return body.data as T;
}

/**
 * The one function UI code needs: anything caught -> a localized string.
 *
 * Replaces the `err?.message || "Something failed"` pattern, which showed users
 * raw backend text when there was any and untranslated English when there was
 * not. A non-API failure (network down, a bug in a click handler) resolves to
 * SERVER_ERROR rather than exposing its message, on the same principle as the
 * server side: unrecognized errors are the ones most likely to say something
 * users should not see.
 */
export function resolveErrorMessage(
  error: unknown,
  locale?: string | null,
  fallbackCode: ErrorCode = "SERVER_ERROR"
): string {
  if (isClientApiError(error)) {
    return translateErrorCode(error.code, locale);
  }

  const mapped =
    error instanceof Error
      ? normalizeErrorCode(error.message)
      : typeof error === "string"
        ? normalizeErrorCode(error)
        : undefined;

  return translateErrorCode(mapped ?? fallbackCode, locale);
}
