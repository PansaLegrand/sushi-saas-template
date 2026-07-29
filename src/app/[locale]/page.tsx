import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";

import { SiteFooter } from "@/components/site-footer";
import { AUTH_ROUTES } from "@/config/auth";
import { SiteConfig } from "@/config/site";
import { Link } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations();

  return buildMetadata({
    locale,
    path: "/",
    title: t("metadata.title") || defaultMetaFallbacks.title,
    description: t("metadata.description") || defaultMetaFallbacks.description,
    keywords: t.raw("metadata.keywords"),
  });
}

/**
 * A deliberately small product entry page.
 *
 * The public marketing and documentation site lives in its own repository.
 * Keeping this page focused on entering the SaaS prevents marketing releases
 * from coupling to the authenticated application's deployment.
 */
export default async function HomePage() {
  const requestHeaders = await headers();
  const [t, session] = await Promise.all([
    getTranslations("landing"),
    auth.api.getSession({ headers: requestHeaders }),
  ]);

  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b border-border/60">
        <nav className="container flex h-16 items-center justify-between">
          <Link href="/" className="text-base font-semibold tracking-tight">
            {SiteConfig.brand}
          </Link>

          <div className="flex items-center gap-4 text-sm">
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
            <Link
              href={session ? AUTH_ROUTES.defaultCallback : AUTH_ROUTES.login}
              className="rounded-md border border-border px-3 py-1.5 font-medium transition hover:bg-muted"
            >
              {session ? t("nav.openApp") : t("nav.signIn")}
            </Link>
          </div>
        </nav>
      </header>

      <section className="container flex flex-1 items-center py-20 md:py-28">
        <div className="max-w-3xl space-y-8">
          <div className="space-y-5">
            <p className="text-sm font-medium text-muted-foreground">
              {SiteConfig.brand}
            </p>
            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl">
              {t("hero.title")}
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
              {t("hero.subtitle")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Link
              href={session ? AUTH_ROUTES.defaultCallback : AUTH_ROUTES.signup}
              className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90"
            >
              {session ? t("hero.ctaOpenApp") : t("hero.ctaPrimary")}
            </Link>
            <Link
              href={session ? "/pricing" : AUTH_ROUTES.login}
              className="text-sm font-medium text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
            >
              {session ? t("nav.pricing") : t("hero.ctaSecondary")}
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-border/60 bg-muted/20 py-10">
        <div className="container grid gap-6 text-sm md:grid-cols-3">
          <p className="leading-relaxed text-muted-foreground">
            {t("proof.auth")}
          </p>
          <p className="leading-relaxed text-muted-foreground">
            {t("proof.billing")}
          </p>
          <p className="leading-relaxed text-muted-foreground">
            {t("proof.operations")}
          </p>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
