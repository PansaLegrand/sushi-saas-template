import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const features = t.raw("features.items") as Array<{
    title: string;
    description: string;
  }>;

  return (
    <main className="relative flex min-h-[calc(100vh-4rem)] flex-col">
      <header className="border-b border-border/60">
        <nav className="container flex h-16 items-center justify-between">
          <span className="text-lg font-semibold tracking-tight">
            {t("nav.label")}
          </span>
          <div className="flex items-center gap-4 text-sm font-medium">
            <Link
              href="/blogs/quick-start"
              className="text-muted-foreground transition hover:text-foreground"
            >
              {t("hero.ctaSecondary")}
            </Link>
            <Link
              href="/api/health"
              className="rounded-full bg-foreground px-4 py-2 text-background transition hover:opacity-90"
            >
              {t("hero.ctaPrimary")}
            </Link>
          </div>
        </nav>
      </header>

      <section className="flex flex-1 items-center justify-center px-6 py-16 md:px-0">
        <div className="container flex flex-col items-center gap-10 text-center">
          <span className="rounded-full border border-dashed border-foreground/30 px-4 py-1 text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Better Auth · Next.js 15 · Tailwind CSS
          </span>
          <h1 className="text-balance text-4xl font-semibold leading-tight md:text-5xl">
            {t("hero.title")}
          </h1>
          <p className="max-w-2xl text-pretty text-base text-muted-foreground md:text-lg">
            {t("hero.subtitle")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/api/health"
              className="rounded-md bg-foreground px-6 py-3 text-base font-medium text-background shadow-sm transition hover:shadow-md"
            >
              {t("hero.ctaPrimary")}
            </Link>
            <Link
              href="/blogs/quick-start"
              className="rounded-md border border-border px-6 py-3 text-base font-medium text-foreground transition hover:bg-foreground/5"
            >
              {t("hero.ctaSecondary")}
            </Link>
          </div>
        </div>
      </section>

      <section id="features" className="bg-muted/40 py-16">
        <div className="container grid gap-8 md:grid-cols-3">
          <div className="md:col-span-3">
            <h2 className="text-center text-2xl font-semibold md:text-3xl">
              {t("features.title")}
            </h2>
          </div>
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-xl border border-border/70 bg-background p-6 text-left shadow-sm"
            >
              <h3 className="text-lg font-semibold text-foreground">
                {feature.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-t border-border/60 py-6 text-center text-sm text-muted-foreground">
        {t("footer")}
      </footer>
    </main>
  );
}
