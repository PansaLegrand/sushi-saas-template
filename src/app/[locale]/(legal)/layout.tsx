import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { SiteConfig } from "@/config/site";
import { SiteFooter } from "@/components/site-footer";

/** Lightweight product chrome for the public legal pages. */
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
              href="/pricing"
              className="text-muted-foreground transition hover:text-foreground"
            >
              {t("nav.pricing")}
            </Link>
            {SiteConfig.docsUrl ? (
              <a
                href={SiteConfig.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground transition hover:text-foreground"
              >
                {t("nav.docs")}
              </a>
            ) : null}
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <SiteFooter />
    </div>
  );
}
