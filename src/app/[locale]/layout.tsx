import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { AppContextProvider } from "@/contexts/app";
import { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "@/providers/theme";
import {
  appName,
  baseUrlFallback,
  defaultMetaFallbacks,
} from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations();
  const keywordsRaw =
    typeof (t as any).raw === "function"
      ? (t as any).raw("metadata.keywords")
      : (t as any)("metadata.keywords");
  const keywords = Array.isArray(keywordsRaw)
    ? keywordsRaw
    : keywordsRaw
    ? (keywordsRaw as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  const title = t("metadata.title") || defaultMetaFallbacks.title;
  const description = t("metadata.description") || defaultMetaFallbacks.description;

  return {
    metadataBase: new URL(baseUrlFallback),
    title: {
      template: "%s",
      default: title,
    },
    description,
    keywords,
    openGraph: {
      title,
      description,
      url: baseUrlFallback,
      siteName: appName,
      locale,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <AppContextProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </AppContextProvider>
    </NextIntlClientProvider>
  );
}
