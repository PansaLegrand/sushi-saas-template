const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, "");
const normalizePath = (path?: string) => {
  if (!path || path === "/") return "";
  return path.startsWith("/") ? path.replace(/\/+$/, "") : `/${path.replace(/\/+$/, "")}`;
};

const normalizeKeywords = (keywords?: string | string[]): string[] | undefined => {
  if (!keywords) return undefined;
  if (Array.isArray(keywords)) return keywords;
  return keywords
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
};

import { defaultLocale, localePrefix, locales } from "@/i18n/locale";
import type { Metadata } from "next";

const FALLBACK_BASE_URL = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Sushi SaaS";
export const appName = APP_NAME;
export const baseUrlFallback = normalizeBaseUrl(FALLBACK_BASE_URL);

type BuildMetadataOptions = {
  locale: string;
  /**
   * Path relative to locale root, e.g. "/", "/pricing", "/blogs/quick-start"
   */
  path?: string;
  title: string;
  description?: string;
  keywords?: string | string[];
  image?: string;
  noindex?: boolean;
};

export function buildMetadata({
  locale,
  path = "/",
  title,
  description,
  keywords,
  image,
  noindex,
}: BuildMetadataOptions): Metadata {
  const baseUrl = normalizeBaseUrl(FALLBACK_BASE_URL);
  const trimmedPath = normalizePath(path);
  const isHome = trimmedPath === "";

  const prefixForLocale = (loc: string) => {
    // With localePrefix === "always", keep the locale segment even for the default locale.
    if (localePrefix === "always" || loc !== defaultLocale) {
      return `/${loc}`;
    }
    return "";
  };

  const localizedPath = `${prefixForLocale(locale)}${trimmedPath}`;
  const canonicalUrl = `${baseUrl}${isHome && localizedPath === "" ? "" : localizedPath}`;

  const languages: Record<string, string> = {};
  for (const loc of locales) {
    const localized = `${prefixForLocale(loc)}${trimmedPath}`;
    languages[loc] = `${baseUrl}${localized || ""}`;
  }

  return {
    metadataBase: new URL(baseUrl),
    title,
    description,
    keywords: normalizeKeywords(keywords),
    alternates: {
      canonical: canonicalUrl,
      languages,
    },
    openGraph: {
      type: "website",
      url: canonicalUrl,
      title,
      description,
      siteName: APP_NAME,
      locale,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
    robots: noindex ? { index: false, follow: true } : undefined,
  };
}

export const defaultMetaFallbacks = {
  title: "Sushi SaaS - Next.js Starter Kit for Real SaaS",
  description: "Launch-ready Next.js SaaS starter with auth, billing, content, and localization.",
};
