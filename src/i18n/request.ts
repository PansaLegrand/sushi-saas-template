import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ locale, requestLocale }) => {
  let resolved = locale;
  if (!resolved) {
    try {
      resolved = await requestLocale;
    } catch {}
  }

  const norm = (resolved ?? "").toString().toLowerCase();
  let normalized = norm;
  if (norm.startsWith("zh")) normalized = "zh";
  else if (norm.startsWith("es")) normalized = "es";
  else if (norm.startsWith("fr")) normalized = "fr";
  else if (norm.startsWith("ja")) normalized = "ja";

  if (!routing.locales.includes(normalized as any)) {
    normalized = routing.defaultLocale as string;
  }

  try {
    const messages = (await import(`../../messages/${normalized}.json`)).default;
    return { locale: normalized, messages };
  } catch {
    const messages = (await import(`../../messages/en.json`)).default;
    return { locale: "en", messages };
  }
});
