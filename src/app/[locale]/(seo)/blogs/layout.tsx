import { blogSource as source } from "@/lib/source";
import { localeNames, locales as supportedLocales, normalizeLocale } from "@/i18n/locale";
import { RootProvider } from "fumadocs-ui/provider";
import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import "fumadocs-ui/css/style.css";
export default async function BlogsLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale?: string }> }>) {
  const { locale } = await params;
  const lang = normalizeLocale(locale);

  const uiLocales = supportedLocales.map((loc) => ({ name: localeNames[loc] ?? loc, locale: loc }));

  return (
    <RootProvider
      i18n={{
        locale: lang,
        locales: uiLocales,
      }}
    >
      <DocsLayout
        // Falls back to an empty tree so a checkout with no content still builds.
        tree={source.pageTree[lang] ?? { name: "", children: [] }}
        searchToggle={{ enabled: false }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
