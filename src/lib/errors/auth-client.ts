/**
 * Better Auth errors -> catalogued, localized copy.
 *
 * Its client returns `{ error: { code?, message?, status? } }` rather than
 * throwing, and both fields carry Better Auth's own English text. Rendering
 * `error.message` directly — which every auth form used to do — puts library
 * strings on screen, untranslated, and changes wording whenever the dependency
 * is upgraded.
 *
 * The app's `error_code` is preferred because it is the stable global catalog
 * code. Better Auth's string `code` and `message` are compatibility fallbacks,
 * followed by the HTTP status. An unrecognized failure resolves to
 * SERVER_ERROR, same no-leak rule as the server side.
 */

import {
  inferErrorCodeFromStatus,
  normalizeErrorCode,
  type ErrorCode,
} from "./catalog";
import { translateErrorCode } from "./i18n";

export interface AuthClientError {
  error_code?: string;
  // Global API envelopes use numeric `code: -1`; Better Auth uses a string.
  code?: string | number;
  message?: string;
  status?: number;
}

export function resolveAuthError(
  error: AuthClientError | null | undefined,
  locale?: string | null
): string {
  const code = resolveAuthErrorCode(error) ?? "SERVER_ERROR";

  return translateErrorCode(code, locale);
}

export function resolveAuthErrorCode(
  error: AuthClientError | null | undefined
): ErrorCode | undefined {
  return (
    normalizeErrorCode(error?.error_code) ??
    normalizeErrorCode(
      typeof error?.code === "string" ? error.code : undefined
    ) ??
    normalizeErrorCode(error?.message) ??
    (typeof error?.status === "number" && Number.isFinite(error.status)
      ? inferErrorCodeFromStatus(error.status)
      : undefined)
  );
}
