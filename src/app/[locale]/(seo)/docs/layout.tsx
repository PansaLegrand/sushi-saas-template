import { source } from "@/lib/source";
import { locales as supportedLocales, localeNames } from "@/i18n/locale";
import { RootProvider } from "fumadocs-ui/provider";
import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import "fumadocs-ui/css/style.css";
export default async function DocsCollectionLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ locale?: string }> }>) {
  const { locale } = await params;
  const lang = (locale && supportedLocales.includes(locale as any) ? locale : "en") as string;

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
