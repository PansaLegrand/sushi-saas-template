import { getLocale, getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";

/**
 * Root 404 — the one an unmatched URL actually reaches.
 *
 * `[locale]/not-found.tsx` only renders when a page calls `notFound()`
 * explicitly. A URL that matches no route at all resolves against the root
 * boundary, so without this file Next serves its unstyled built-in page. Both
 * files are needed; neither covers the other's case.
 *
 * Uses a plain `<a>` rather than the locale-aware `Link`: this renders outside
 * the `[locale]` segment, where there is no routing context to build against.
 */
export default async function NotFound() {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: "errors" });

  return (
    <main className="container flex min-h-[60vh] flex-col items-center justify-center gap-4 py-16 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">{t("notFoundTitle")}</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {t("notFoundDescription")}
      </p>
      <Button asChild className="mt-2">
        <a href={`/${locale}`}>{t("home")}</a>
      </Button>
    </main>
  );
}
