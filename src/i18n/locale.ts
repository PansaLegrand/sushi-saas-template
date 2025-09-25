export const locales = ["en", "zh", "es", "fr", "ja"];

export const localeNames: any = {
  en: "English",
  zh: "中文",
  es: "Español",
  fr: "Français",
  ja: "日本語",
};

export const defaultLocale = "en";

export const localePrefix = "always";

export const localeDetection =
  process.env.NEXT_PUBLIC_LOCALE_DETECTION === "true";
