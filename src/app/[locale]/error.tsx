"use client";

/**
 * Segment error boundary for every localized page.
 *
 * Without this file, a throw in any page or layout below `[locale]` rendered
 * Next.js's built-in error screen: unstyled, English-only, and in production a
 * bare "Application error: a client-side exception has occurred". The server
 * already refuses to leak error text through `respError`; this is the same
 * guarantee for the render path.
 *
 * `error.message` is deliberately never rendered. In a production build Next
 * replaces it with a generic string anyway, and in development it is a stack
 * trace fragment — neither is copy for a user. `resolveErrorMessage` maps
 * whatever was thrown onto catalogued, translated copy, and `digest` is shown
 * so a user can quote it in a support request.
 */

import { useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveErrorMessage } from "@/lib/errors/client";

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  const locale = useLocale();

  useEffect(() => {
    // The server logs its own failures; this catches the ones that only happen
    // in the browser, which otherwise leave no trace anywhere.
    console.error(error);
  }, [error]);

  return (
    <main className="container flex min-h-[60vh] flex-col items-center justify-center gap-6 py-16 text-center">
      <Alert variant="destructive" className="max-w-lg text-left">
        <AlertTitle>{t("title")}</AlertTitle>
        <AlertDescription>
          <p>{resolveErrorMessage(error, locale)}</p>
          {error.digest ? (
            <p className="mt-2 font-mono text-xs opacity-70">
              {t("digest")}: {error.digest}
            </p>
          ) : null}
        </AlertDescription>
      </Alert>

      <p className="max-w-md text-sm text-muted-foreground">{t("description")}</p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>{t("retry")}</Button>
        <Button variant="outline" asChild>
          <Link href="/">{t("home")}</Link>
        </Button>
      </div>
    </main>
  );
}
