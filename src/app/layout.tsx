import "@/app/globals.css";

import { getLocale, setRequestLocale } from "next-intl/server";
import { defaultLocale, localePrefix, locales } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { baseUrlFallback } from "@/lib/seo";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  setRequestLocale(locale);

  const webUrl = baseUrlFallback;
  const googleAdsenseCode = process.env.NEXT_PUBLIC_GOOGLE_ADCODE || "";
  const localeHref = (loc: string) => {
    const prefix =
      localePrefix === "always" || loc !== defaultLocale ? `/${loc}` : "";
    return `${webUrl}${prefix}`;
  };

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {googleAdsenseCode && (
          <meta name="google-adsense-account" content={googleAdsenseCode} />
        )}

        <link rel="icon" href="/favicon.ico" />

        {locales &&
          locales.map((loc) => (
            <link
              key={loc}
              rel="alternate"
              hrefLang={loc}
              href={localeHref(loc)}
            />
          ))}
        <link
          rel="alternate"
          hrefLang="x-default"
          href={localeHref(defaultLocale)}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
