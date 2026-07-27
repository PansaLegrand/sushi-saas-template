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

import { absoluteLocaleUrl, locales } from "@/i18n/locale";
import type { Metadata } from "next";
import { getAppEnv } from "@/lib/env";

const FALLBACK_BASE_URL = getAppEnv().NEXT_PUBLIC_WEB_URL;
const APP_NAME = getAppEnv().NEXT_PUBLIC_APP_NAME;
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
  const canonicalUrl = absoluteLocaleUrl(baseUrl, locale, trimmedPath || "/");

  const languages: Record<string, string> = {};
  for (const loc of locales) {
    languages[loc] = absoluteLocaleUrl(baseUrl, loc, trimmedPath || "/");
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
