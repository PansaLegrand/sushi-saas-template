import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import ReserveModalButton from "@/components/reserve-modal-button";

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

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const features = t.raw("features.items") as Array<{
    title: string;
    description: string;
  }>;
  const aboutPoints = t.raw("about.points") as Array<{
    title: string;
    description: string;
  }>;
  const showcases = t.raw("showcases.items") as Array<{
    name: string;
    url: string;
    description: string;
  }>;
  const stack = t.raw("stack.items") as Array<{
    name: string;
    description?: string;
  }>;

  return (
    <main className="relative flex min-h-[calc(100vh-4rem)] flex-col">
      <header className="border-b border-border/60">
        <nav className="container flex h-16 items-center justify-between">
          <span className="text-lg font-semibold tracking-tight">
            {t("nav.label")}
          </span>
          <div className="flex items-center gap-4 text-sm font-medium">
            <Link href="/blogs" className="text-muted-foreground transition hover:text-foreground">
              {t("nav.blogs")}
            </Link>
            <Link href="#showcases" className="text-muted-foreground transition hover:text-foreground">
              {t("hero.ctaSecondary")}
            </Link>
            <ReserveModalButton
              label={t("hero.ctaPrimary")}
              title={t("reserveModal.title")}
              description={t("reserveModal.desc")}
              closeLabel={t("reserveModal.close")}
              emailCtaLabel={t("reserveModal.emailCta")}
              buttonClassName="rounded-full bg-foreground px-4 py-2 text-background transition hover:opacity-90"
            />
          </div>
        </nav>
      </header>

      <section className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-20 md:px-0">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-[-20%] h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-gradient-to-br from-primary/10 via-primary/5 to-transparent blur-3xl" />
          <div className="absolute right-[-10%] bottom-[-20%] h-[30rem] w-[30rem] rounded-full bg-gradient-to-tr from-purple-500/10 to-transparent blur-3xl dark:from-purple-400/10" />
        </div>
        <div className="container flex flex-col items-center gap-8 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-4 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span>⭐</span>
            <span>{t("hero.badge")}</span>
            <a
              href="https://github.com/PansaLegrand/sushi-saas-template"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              GitHub
            </a>
          </span>
          <h1 className="text-balance text-5xl font-semibold leading-tight tracking-tight md:text-6xl">
            {t("hero.title")}
          </h1>
          <p className="max-w-2xl text-pretty text-base text-muted-foreground md:text-lg">
            {t("hero.subtitle")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <ReserveModalButton
              label={t("hero.ctaPrimary")}
              title={t("reserveModal.title")}
              description={t("reserveModal.desc")}
              closeLabel={t("reserveModal.close")}
              emailCtaLabel={t("reserveModal.emailCta")}
            />
            <Link href="#showcases" className="rounded-md border border-border px-6 py-3 text-base font-medium text-foreground transition hover:bg-foreground/5">
              {t("hero.ctaSecondary")}
            </Link>
            <a
              href="https://github.com/PansaLegrand/sushi-saas-template"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-border px-6 py-3 text-base font-medium text-foreground transition hover:bg-foreground/5"
            >
              {t("hero.ctaGitHub")}
            </a>
            <a
              href="https://discord.gg/aACy5qNf"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-border px-6 py-3 text-base font-medium text-foreground transition hover:bg-foreground/5"
            >
              {t("hero.ctaDiscord")}
            </a>
            <a
              href="https://x.com/WenzhuPan"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-border px-6 py-3 text-base font-medium text-foreground transition hover:bg-foreground/5"
            >
              {t("hero.ctaX")}
            </a>
          </div>
        </div>
      </section>

      <section id="about" className="border-y border-border/60 bg-background py-16">
        <div className="container grid gap-8 md:grid-cols-2">
          <div className="space-y-4">
            <h2 className="text-3xl font-semibold tracking-tight">
              {t("about.title")}
            </h2>
            <p className="text-base text-muted-foreground">
              {t("about.intro")}
            </p>
          </div>
          <div className="grid gap-4">
            {aboutPoints.map((point) => (
              <div
                key={point.title}
                className="rounded-xl border border-border/70 bg-muted/40 p-4"
              >
                <h3 className="text-base font-semibold">{point.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {point.description}
                </p>
              </div>
            ))}
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

      <section id="showcases" className="py-16">
        <div className="container grid gap-8 md:grid-cols-3">
          <div className="md:col-span-3">
            <h2 className="text-center text-2xl font-semibold md:text-3xl">
              {t("showcases.title")}
            </h2>
          </div>
          {showcases.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-border/70 bg-background p-6 text-left shadow-sm transition hover:shadow-md"
            >
              <h3 className="text-lg font-semibold text-foreground">{s.name}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {s.description}
              </p>
              <span className="mt-4 inline-block text-xs text-muted-foreground underline">
                {s.url}
              </span>
            </a>
          ))}
        </div>
      </section>

      <section id="stack" className="bg-muted/40 py-16">
        <div className="container">
          <h2 className="mb-6 text-center text-2xl font-semibold md:text-3xl">
            {t("stack.title")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            {stack.map((tech) => (
              <div
                key={tech.name}
                className="rounded-lg border border-border/70 bg-background p-4 text-center"
              >
                <div className="text-sm font-medium">{tech.name}</div>
                {tech.description && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {tech.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border/60 py-6 text-center text-sm text-muted-foreground">
        <div className="container flex flex-wrap items-center justify-center gap-4">
          <span>{t("footer")}</span>
          <a
            href="https://discord.gg/aACy5qNf"
            target="_blank"
            rel="noopener noreferrer"
            className="underline transition hover:text-foreground"
          >
            Discord
          </a>
          <a
            href="https://x.com/WenzhuPan"
            target="_blank"
            rel="noopener noreferrer"
            className="underline transition hover:text-foreground"
          >
            X
          </a>
        </div>
      </footer>
    </main>
  );
}
