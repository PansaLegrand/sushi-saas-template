/**
 * Better Auth errors -> catalogued, localized copy.
 *
 * Its client returns `{ error: { code?, message?, status? } }` rather than
 * throwing, and both fields carry Better Auth's own English text. Rendering
 * `error.message` directly — which every auth form used to do — puts library
 * strings on screen, untranslated, and changes wording whenever the dependency
 * is upgraded.
 *
 * `code` is preferred because it is stable; `message` is tried next for the
 * plugin errors that ship without one (the captcha plugin is the reason). An
 * unrecognized failure resolves to SERVER_ERROR, same no-leak rule as the
 * server side.
 */

import { normalizeErrorCode } from "./catalog";
import { translateErrorCode } from "./i18n";

export interface AuthClientError {
  code?: string;
  message?: string;
  status?: number;
}

export function resolveAuthError(
  error: AuthClientError | null | undefined,
  locale?: string | null
): string {
  const code =
    normalizeErrorCode(error?.code) ??
    normalizeErrorCode(error?.message) ??
    "SERVER_ERROR";

  return translateErrorCode(code, locale);
}
