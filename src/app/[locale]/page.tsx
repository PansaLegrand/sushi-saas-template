import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const features = t.raw("features.items") as Array<{
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
            <Link
              href="/blogs/about"
              className="text-muted-foreground transition hover:text-foreground"
            >
              {t("hero.ctaSecondary")}
            </Link>
            <Link
              href="/blogs/quick-start"
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
              href="/blogs/quick-start"
              className="rounded-md bg-foreground px-6 py-3 text-base font-medium text-background shadow-sm transition hover:shadow-md"
            >
              {t("hero.ctaPrimary")}
            </Link>
            <Link
              href="/blogs/about"
              className="rounded-md border border-border px-6 py-3 text-base font-medium text-foreground transition hover:bg-foreground/5"
            >
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
