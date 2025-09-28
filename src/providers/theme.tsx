"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { ReactNode, useEffect } from "react";
import { useLocale } from "next-intl";
import { Toaster } from "sonner";
import Adsense from "./adsense";
import { GoogleAnalytics } from "./google-analytics";
import AffiliateInit from "./affiliate-init";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();

  useEffect(() => {
    if (typeof window !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={process.env.NEXT_PUBLIC_DEFAULT_THEME || "system"}
      enableSystem
      disableTransitionOnChange
    >
      {children}

      <Toaster position="top-center" richColors />
      <GoogleAnalytics />
      <AffiliateInit />
      <Adsense />
    </NextThemesProvider>
  );
}
