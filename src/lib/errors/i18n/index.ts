import en from "./locales/en.json";
import zh from "./locales/zh.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";

import { type ErrorCode, normalizeErrorCode } from "../catalog";

/**
 * Error copy lives here, not in `messages/*.json`.
 *
 * Two reasons. Backend exception semantics are a different vocabulary from
 * product copy, and mixing them means every translator has to reason about
 * `PAYMENT_WEBHOOK_INVALID_SIGNATURE` alongside hero headlines. And this bundle
 * is keyed by error code, which lets any component translate a failure without
 * knowing which feature namespace it came from.
 */
const ERROR_TRANSLATIONS = { en, zh, es, fr, ja } as const;

export type ErrorLocale = keyof typeof ERROR_TRANSLATIONS;

const FALLBACK_LOCALE: ErrorLocale = "en";

export function isErrorLocale(value: unknown): value is ErrorLocale {
  return typeof value === "string" && value in ERROR_TRANSLATIONS;
}

/** Accepts "zh", "ZH", "zh-CN", or junk; always returns a usable locale. */
export function resolveErrorLocale(value: string | null | undefined): ErrorLocale {
  if (isErrorLocale(value)) return value;

  const base = value?.trim().toLowerCase().split(/[-_]/)[0];
  return isErrorLocale(base) ? base : FALLBACK_LOCALE;
}

/**
 * Look up user-facing copy for an error code.
 *
 * Falls back through: requested locale -> English -> caller's fallback -> the
 * code itself. The last step is deliberate: seeing `TASK_PROVIDER_FAILED` in the
 * UI is a visible bug report for a missing translation, whereas an empty string
 * is a silent one.
 */
export function translateErrorCode(
  code: string | null | undefined,
  locale?: string | null,
  fallbackMessage?: string
): string {
  if (!code) return fallbackMessage ?? "";

  const normalized = normalizeErrorCode(code);
  const key = (normalized ?? code) as ErrorCode;

  const requested = ERROR_TRANSLATIONS[resolveErrorLocale(locale)] as Record<string, string>;
  const english = ERROR_TRANSLATIONS[FALLBACK_LOCALE] as Record<string, string>;

  return requested[key] ?? english[key] ?? fallbackMessage ?? key;
}

/** Every locale bundle, for the parity test in tests/unit. */
export function getErrorTranslationBundles(): Record<
  ErrorLocale,
  Record<string, string>
> {
  return ERROR_TRANSLATIONS as unknown as Record<ErrorLocale, Record<string, string>>;
}
