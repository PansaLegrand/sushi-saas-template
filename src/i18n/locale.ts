export const availableLocales = ["en", "zh", "es", "fr", "ja"] as const;

export type AppLocale = (typeof availableLocales)[number];

export const localeNames: Record<AppLocale, string> = {
  en: "English",
  zh: "中文",
  es: "Español",
  fr: "Français",
  ja: "日本語",
};

const localeAliases: Record<string, AppLocale> = {
  en: "en",
  "en-us": "en",
  zh: "zh",
  "zh-cn": "zh",
  "zh-tw": "zh",
  "zh-hk": "zh",
  "zh-mo": "zh",
  es: "es",
  fr: "fr",
  ja: "ja",
};

const fallbackLocale: AppLocale = "en";

function resolveAvailableLocale(locale?: string | null): AppLocale | null {
  const value = (locale ?? "").toString().trim().toLowerCase();
  return localeAliases[value] ?? null;
}

export const defaultLocale =
  resolveAvailableLocale(process.env.NEXT_PUBLIC_DEFAULT_LOCALE) ?? fallbackLocale;

function parseEnabledLocales(value?: string | null): AppLocale[] {
  const raw = (value ?? "").trim();
  if (!raw || raw.toLowerCase() === "all") {
    return [...availableLocales];
  }

  const seen = new Set<AppLocale>();
  for (const part of raw.split(/[,\s]+/)) {
    const locale = resolveAvailableLocale(part);
    if (locale) seen.add(locale);
  }

  const enabled = Array.from(seen);
  if (enabled.length === 0) {
    return [defaultLocale];
  }

  return enabled.includes(defaultLocale)
    ? enabled
    : [defaultLocale, ...enabled];
}

export const locales = parseEnabledLocales(process.env.NEXT_PUBLIC_LOCALES);

export const localePrefix: "always" | "as-needed" | "never" = "as-needed";

export const localeDetection =
  process.env.NEXT_PUBLIC_LOCALE_DETECTION === "true";

export function normalizeLocale(locale?: string | null): AppLocale {
  const resolved = resolveAvailableLocale(locale);
  return resolved && locales.includes(resolved) ? resolved : defaultLocale;
}

export function isEnabledLocale(locale?: string | null): locale is AppLocale {
  const resolved = resolveAvailableLocale(locale);
  return Boolean(resolved && locales.includes(resolved));
}

function normalizePath(path?: string | null) {
  if (!path || path === "/") return "";

  const prefixed = `/${path.replace(/^\/+/, "")}`;
  return prefixed.replace(/\/+$/, "");
}

export function localePath(locale?: string | null, path: string = "/") {
  const normalized = normalizeLocale(locale);
  const suffix = normalizePath(path);
  const prefix =
    localePrefix !== "never" &&
    (localePrefix === "always" || normalized !== defaultLocale)
      ? `/${normalized}`
      : "";

  return `${prefix}${suffix}` || "/";
}

export function absoluteLocaleUrl(
  base: string,
  locale?: string | null,
  path: string = "/"
) {
  const url = new URL(localePath(locale, path), base);
  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  const value = url.toString();
  return url.pathname === "/" && !url.search && !url.hash
    ? value.replace(/\/$/, "")
    : value;
}
