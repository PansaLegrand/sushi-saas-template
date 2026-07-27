// .source folder will be generated when you run `next dev`
import { blog, docs } from "@/.source";
import { loader } from "fumadocs-core/source";
import { icons } from "lucide-react";
import type { I18nConfig } from "fumadocs-core/i18n";
import { createElement } from "react";
import { defaultLocale, locales } from "@/i18n/locale";

export const i18n: I18nConfig = {
  defaultLanguage: defaultLocale,
  languages: locales,
  // Our content lives in per-locale folders like `en/...`, `zh/...`
  parser: "dir",
};

function resolveIcon(icon?: string) {
  if (!icon) {
    // You may set a default icon
    return;
  }
  if (icon in icons) return createElement(icons[icon as keyof typeof icons]);
}

/**
 * Template documentation (`content/docs`), served at `/docs`. Part of the
 * starter kit itself.
 */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  i18n,
  icon: resolveIcon,
});

/**
 * Site content (`content/blog`), served at `/blogs`. Belongs to whoever deploys
 * this, not to the template — a clean checkout has none and the route renders
 * an empty index.
 */
export const blogSource = loader({
  baseUrl: "/blogs",
  source: blog.toFumadocsSource(),
  i18n,
  icon: resolveIcon,
});
