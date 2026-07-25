/**
 * The error catalog: every failure this app can report to a user.
 *
 * One entry per distinct thing that can go wrong. The key is a stable machine
 * code that crosses the network, gets logged, and gets translated. It is the
 * only part of an error the frontend is allowed to branch on — never the
 * message text, which changes with copy edits and differs per locale.
 *
 * `defaultMessage` is an English fallback for logs and for clients that send no
 * locale. User-facing copy lives in `./i18n/locales/*.json`, keyed by the same
 * code. Both must stay in sync; `tests/unit/errors.catalog.test.ts` enforces it.
 *
 * Adding a failure mode means adding an entry here first. Do not invent a code
 * at a call site — an uncatalogued code has no status, no message, and no
 * translation.
 */

export type ErrorCatalogEntry = {
  /** HTTP status returned when this error reaches a route boundary. */
  statusCode: number;
  /** English fallback. Logs and no-locale clients. */
  defaultMessage: string;
  /**
   * Older ad-hoc strings that mean this. Lets `normalizeErrorCode` map legacy
   * throws onto a canonical code during the incremental migration, so the
   * frontend can adopt codes before every route has been converted.
   */
  legacyCodes?: readonly string[];
};

export const ERROR_CATALOG = {
  // ---------------------------------------------------------------- auth
  AUTH_REQUIRED: {
    statusCode: 401,
    defaultMessage: "Please sign in to continue.",
    legacyCodes: ["UNAUTHORIZED", "no auth", "no auth, please sign-in"],
  },
  AUTH_FORBIDDEN: {
    statusCode: 403,
    defaultMessage: "You do not have permission to do that.",
    // Alias matching is case-insensitive, so listing both cases is redundant.
    legacyCodes: ["FORBIDDEN"],
  },
  AUTH_EMAIL_NOT_VERIFIED: {
    statusCode: 403,
    defaultMessage: "Please verify your email address first.",
    legacyCodes: ["Email not verified"],
  },
  AUTH_CAPTCHA_REQUIRED: {
    statusCode: 400,
    defaultMessage: "Please complete the verification challenge.",
    legacyCodes: ["Missing CAPTCHA response"],
  },
  AUTH_CAPTCHA_FAILED: {
    statusCode: 400,
    defaultMessage: "Verification failed. Please try again.",
    legacyCodes: ["Captcha verification failed"],
  },
  AUTH_ADMIN_READ_ONLY: {
    statusCode: 403,
    defaultMessage: "Your admin account cannot perform write actions.",
  },
  ACCOUNT_NOT_FOUND: {
    statusCode: 404,
    defaultMessage: "Account not found.",
    legacyCodes: ["user not exist", "invalid user"],
  },

  // ------------------------------------------------------------- request
  REQUEST_INVALID: {
    statusCode: 400,
    defaultMessage: "The request is invalid.",
    legacyCodes: ["INVALID_REQUEST", "BAD_REQUEST", "invalid params"],
  },
  REQUEST_MALFORMED_JSON: {
    statusCode: 400,
    defaultMessage: "The request body is not valid JSON.",
    legacyCodes: ["invalid json"],
  },
  REQUEST_VALIDATION_FAILED: {
    statusCode: 400,
    defaultMessage: "Some fields need attention.",
  },
  REQUEST_MISSING_FIELD: {
    statusCode: 400,
    defaultMessage: "A required field is missing.",
    legacyCodes: ["uuid required", "userUuid required", "idempotencyKey required"],
  },
  REQUEST_ORIGIN_REJECTED: {
    statusCode: 403,
    defaultMessage: "This request came from an unrecognized origin.",
  },
  REQUEST_RATE_LIMITED: {
    statusCode: 429,
    defaultMessage: "Too many requests. Please wait a moment and try again.",
  },
  RESOURCE_NOT_FOUND: {
    statusCode: 404,
    defaultMessage: "Not found.",
    legacyCodes: ["NOT_FOUND", "not found"],
  },

  // ------------------------------------------------------------- credits
  CREDITS_INSUFFICIENT: {
    statusCode: 400,
    defaultMessage: "You do not have enough credits for this.",
    legacyCodes: ["INSUFFICIENT_CREDITS", "insufficient credits"],
  },
  CREDITS_INVALID_AMOUNT: {
    statusCode: 400,
    defaultMessage: "The credit amount is invalid.",
    legacyCodes: ["credits must be a positive number", "credits must be greater than zero"],
  },
  CREDITS_GRANT_LIMIT_EXCEEDED: {
    statusCode: 400,
    defaultMessage: "That exceeds the maximum a single grant may issue.",
  },
  CREDITS_GRANT_FAILED: {
    statusCode: 500,
    defaultMessage: "The credit grant could not be completed.",
    legacyCodes: ["grant credits failed"],
  },
  CREDITS_TRANSACTION_NOT_FOUND: {
    statusCode: 404,
    defaultMessage: "That credit transaction was not found.",
    legacyCodes: ["original credit transaction not found"],
  },

  // ------------------------------------------------------ orders/payment
  ORDER_INVALID_PRODUCT: {
    statusCode: 400,
    defaultMessage: "That product is not available.",
    legacyCodes: ["invalid pricing table", "invalid checkout params"],
  },
  ORDER_CREATE_FAILED: {
    statusCode: 500,
    defaultMessage: "We could not start your order. Please try again.",
  },
  PAYMENT_SESSION_FAILED: {
    statusCode: 502,
    defaultMessage: "The payment provider is unavailable. Please try again shortly.",
    legacyCodes: ["checkout failed"],
  },
  PAYMENT_WEBHOOK_INVALID_SIGNATURE: {
    statusCode: 400,
    defaultMessage: "The webhook signature could not be verified.",
  },

  // ------------------------------------------------------------- storage
  STORAGE_FILE_NOT_FOUND: {
    statusCode: 404,
    defaultMessage: "That file was not found.",
    legacyCodes: ["file not found", "missing fileUuid"],
  },
  STORAGE_OBJECT_MISSING: {
    statusCode: 404,
    defaultMessage: "The stored file is missing.",
    legacyCodes: ["object not found in storage"],
  },
  STORAGE_FILE_TOO_LARGE: {
    statusCode: 413,
    defaultMessage: "That file is too large.",
  },
  STORAGE_SIZE_MISMATCH: {
    statusCode: 400,
    defaultMessage: "The uploaded file did not match the expected size.",
    legacyCodes: ["uploaded size mismatch"],
  },
  STORAGE_UPLOAD_FAILED: {
    statusCode: 500,
    defaultMessage: "The upload could not be completed.",
  },

  // --------------------------------------------------------------- tasks
  TASK_NOT_FOUND: {
    statusCode: 404,
    defaultMessage: "That task was not found.",
  },
  TASK_PROMPT_REQUIRED: {
    statusCode: 400,
    defaultMessage: "Please enter a prompt.",
    legacyCodes: ["prompt is required"],
  },
  TASK_CREATE_FAILED: {
    statusCode: 500,
    defaultMessage: "The task could not be created. Please try again.",
    legacyCodes: ["create task failed"],
  },
  TASK_PROVIDER_FAILED: {
    statusCode: 502,
    defaultMessage: "The generation service failed. Please try again.",
  },

  // -------------------------------------------------------- reservations
  RESERVATION_NOT_FOUND: {
    statusCode: 404,
    defaultMessage: "That reservation was not found.",
  },
  RESERVATION_SLOT_UNAVAILABLE: {
    statusCode: 409,
    defaultMessage: "That time slot is no longer available.",
    legacyCodes: ["time slot unavailable"],
  },
  RESERVATION_AVAILABILITY_FAILED: {
    statusCode: 500,
    defaultMessage: "Availability could not be loaded. Please try again.",
  },
  RESERVATION_CREATE_FAILED: {
    statusCode: 500,
    defaultMessage: "The reservation could not be created. Please try again.",
  },
  RESERVATION_HOLD_EXPIRED: {
    statusCode: 409,
    defaultMessage: "Your hold on this slot expired. Please pick a time again.",
  },
  RESERVATION_CANCEL_WINDOW_PASSED: {
    statusCode: 403,
    defaultMessage: "This reservation can no longer be cancelled online.",
  },

  // -------------------------------------------------------------- system
  FEATURE_DISABLED: {
    statusCode: 403,
    defaultMessage: "This feature is not enabled.",
  },
  SERVICE_UNAVAILABLE: {
    statusCode: 503,
    defaultMessage: "The service is temporarily unavailable. Please try again shortly.",
  },
  SERVER_ERROR: {
    statusCode: 500,
    defaultMessage: "Something went wrong on our end. Please try again.",
    legacyCodes: ["INTERNAL_ERROR"],
  },
} as const satisfies Record<string, ErrorCatalogEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ERROR_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];

export function getErrorDefinition(code: ErrorCode): ErrorCatalogEntry {
  return ERROR_CATALOG[code];
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && value in ERROR_CATALOG;
}

/** Legacy string -> canonical code, built once at module load. */
const LEGACY_LOOKUP: Record<string, ErrorCode> = (() => {
  const map: Record<string, ErrorCode> = {};
  for (const code of ERROR_CODES) {
    // Via getErrorDefinition rather than indexing directly: `as const satisfies`
    // narrows each entry to its own literal type, so entries with no aliases have
    // no `legacyCodes` property at all.
    for (const legacy of getErrorDefinition(code).legacyCodes ?? []) {
      map[legacy.toLowerCase()] = code;
    }
  }
  return map;
})();

/**
 * Resolve any incoming value to a catalog code.
 *
 * Accepts a canonical code, a legacy alias, or one of the ad-hoc English
 * strings the app used to throw. Returns undefined when nothing matches, so
 * callers can decide between a default and a generic server error rather than
 * silently mislabelling a failure.
 */
export function normalizeErrorCode(
  value: string | null | undefined
): ErrorCode | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (isErrorCode(trimmed)) return trimmed;

  const upper = trimmed.toUpperCase().replace(/[\s-]+/g, "_");
  if (isErrorCode(upper)) return upper;

  return LEGACY_LOOKUP[trimmed.toLowerCase()];
}

/** Fallback when only an HTTP status is known. */
export function inferErrorCodeFromStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return "REQUEST_INVALID";
    case 401:
      return "AUTH_REQUIRED";
    case 403:
      return "AUTH_FORBIDDEN";
    case 404:
      return "RESOURCE_NOT_FOUND";
    case 413:
      return "STORAGE_FILE_TOO_LARGE";
    case 429:
      return "REQUEST_RATE_LIMITED";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return status >= 500 ? "SERVER_ERROR" : "REQUEST_INVALID";
  }
}
