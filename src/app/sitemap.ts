import type { MetadataRoute } from "next";

import { absoluteLocaleUrl, locales } from "@/i18n/locale";

const PUBLIC_PATHS = ["/", "/pricing", "/privacy", "/terms"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";

  return locales.flatMap((locale) =>
    PUBLIC_PATHS.map((path) => ({
      url: absoluteLocaleUrl(baseUrl, locale, path),
      lastModified: new Date(),
      changeFrequency: path === "/" ? "weekly" : "monthly",
      priority: path === "/" ? 1 : path === "/pricing" ? 0.8 : 0.3,
    }))
  );
}
