import { getRequestConfig } from "next-intl/server";
import { normalizeLocale } from "./locale";

export default getRequestConfig(async ({ locale, requestLocale }) => {
  let resolved = locale;
  if (!resolved) {
    try {
      resolved = await requestLocale;
    } catch {}
  }

  const normalized = normalizeLocale(resolved);

  try {
    const messages = (await import(`../../messages/${normalized}.json`)).default;
    return { locale: normalized, messages };
  } catch {
    const messages = (await import(`../../messages/en.json`)).default;
    return { locale: "en", messages };
  }
});
