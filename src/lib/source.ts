// .source folder will be generated when you run `next dev`
import { docs } from "@/.source";
import { loader } from "fumadocs-core/source";
import { icons } from "lucide-react";
import type { I18nConfig } from "fumadocs-core/i18n";
import { createElement } from "react";

export const i18n: I18nConfig = {
  defaultLanguage: "en",
  languages: ["en", "zh", "es", "fr", "ja"],
  // Our content lives in per-locale folders like `en/...`, `zh/...`
  parser: "dir",
};

export const source = loader({
  baseUrl: "/blogs",
  source: docs.toFumadocsSource(),
  i18n,
  icon(icon) {
    if (!icon) {
      // You may set a default icon
      return;
    }
    if (icon in icons) return createElement(icons[icon as keyof typeof icons]);
  },
});
