import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import { SiteConfig } from "@/config/site";
import { SiteFooter } from "@/components/site-footer";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations();
  const keywords =
    typeof (t as any).raw === "function"
      ? (t as any).raw("metadata.keywords")
      : (t as any)("metadata.keywords");

  return buildMetadata({
    locale,
    path: "/",
    title: t("metadata.title") || defaultMetaFallbacks.title,
    description: t("metadata.description") || defaultMetaFallbacks.description,
    keywords,
  });
}

/**
 * The landing page.
 *
 * Deliberately typographic rather than card-heavy. The previous version wrapped
 * every idea in a bordered box, which flattens the hierarchy — when everything
 * is a card, nothing reads as more important than anything else, and the message
 * competes with its own chrome. Here one sentence carries the page and the
 * supporting detail stays quiet.
 *
 * Nothing on this page is site-specific except what comes from `SiteConfig`, so
 * a clone of the kit gets a neutral page rather than someone else's showcases.
 */
export default async function LandingPage() {
  const t = await getTranslations("landing");
  const features = t.raw("features.items") as Array<{
    title: string;
    description: string;
  }>;
  const stack = t.raw("stack.items") as Array<{ name: string }>;

  return (
    <main className="flex min-h-screen flex-col">
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
            <Link
              href="/blogs"
              className="text-muted-foreground transition hover:text-foreground"
            >
              {t("nav.blogs")}
            </Link>
            {SiteConfig.repositoryUrl ? (
              <a
                href={SiteConfig.repositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground transition hover:text-foreground"
              >
                {t("nav.github")}
              </a>
            ) : null}
          </div>
        </nav>
      </header>

      <section className="container flex flex-1 flex-col justify-center py-24 md:py-36">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight md:text-6xl">
            {t("hero.title")}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {t("hero.subtitle")}
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-6">
            <Link
              href="/docs"
              className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90"
            >
              {t("hero.ctaPrimary")}
            </Link>
            {SiteConfig.repositoryUrl ? (
              <a
                href={SiteConfig.repositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
              >
                {t("hero.ctaSecondary")}
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <section id="about" className="border-t border-border/60 py-24">
        <div className="container max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight">
            {t("about.title")}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            {t("about.intro")}
          </p>
        </div>
      </section>

      <section id="features" className="border-t border-border/60 py-24">
        <div className="container">
          <h2 className="text-2xl font-semibold tracking-tight">
            {t("features.title")}
          </h2>
          <dl className="mt-10 grid gap-x-12 gap-y-10 md:grid-cols-2">
            {features.map((feature) => (
              <div key={feature.title}>
                <dt className="text-sm font-medium text-foreground">
                  {feature.title}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {SiteConfig.showcases.length > 0 ? (
        <section id="showcases" className="border-t border-border/60 py-24">
          <div className="container">
            <h2 className="text-2xl font-semibold tracking-tight">
              {t("showcases.title")}
            </h2>
            <ul className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
              {SiteConfig.showcases.map((item) => (
                <li key={item.url}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {item.name}
                  </a>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="border-t border-border/60 py-16">
        <div className="container flex flex-wrap items-baseline gap-x-6 gap-y-3">
          <h2 className="text-sm font-medium">{t("stack.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {stack.map((tech) => tech.name).join(" · ")}
          </p>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
