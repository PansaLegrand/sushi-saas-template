/**
 * Unified error handling. See docs/errors.md.
 *
 * Server code throws `AppError` with a catalog code; route boundaries call
 * `respError`; the browser parses with `readApiError` / `parseApiResponse` and
 * displays with `resolveErrorMessage`.
 *
 * `response.ts` is server-only, so it is not re-exported here — importing this
 * barrel from a client component must stay safe. Import it directly in routes:
 *   import { respError } from "@/lib/errors/response";
 */
export {
  ERROR_CATALOG,
  ERROR_CODES,
  type ErrorCatalogEntry,
  type ErrorCode,
  getErrorDefinition,
  inferErrorCodeFromStatus,
  isErrorCode,
  normalizeErrorCode,
} from "./catalog";

export {
  AppError,
  type AppErrorOptions,
  appErrorFromStatus,
  isAppError,
  toAppError,
} from "./app-error";

export {
  ClientApiError,
  isClientApiError,
  parseApiResponse,
  readApiError,
  resolveErrorMessage,
} from "./client";

export {
  type ErrorLocale,
  getErrorTranslationBundles,
  isErrorLocale,
  resolveErrorLocale,
  translateErrorCode,
} from "./i18n";
