import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { SiteConfig } from "@/config/site";
import { SiteFooter } from "@/components/site-footer";

/**
 * Chrome for the legal pages.
 *
 * These have to render on a `site`-mode deployment too, which has no database,
 * so nothing here may touch a signed-in surface.
 */
export default async function LegalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("landing");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border/60">
        <nav className="container flex h-16 items-center justify-between">
          <Link href="/" className="text-base font-semibold tracking-tight">
            {SiteConfig.brand}
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <Link
              href="/docs"
              className="text-muted-foreground transition hover:text-foreground"
            >
              {t("nav.docs")}
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <SiteFooter />
    </div>
  );
}
