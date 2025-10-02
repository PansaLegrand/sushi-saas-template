import { source } from "@/lib/source";
import { locales as supportedLocales } from "@/i18n/locale";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { DocsPage, DocsBody, DocsDescription, DocsTitle } from "fumadocs-ui/page";

type Params = { locale?: string };

export default async function BlogsIndexPage(props: { params: Promise<Params> }) {
  const { locale } = await props.params;
  const lang = (locale && supportedLocales.includes(locale as any) ? locale : "en") as string;
  const t = await getTranslations("blogs");

  // Get all pages for the current language and sort by publish/update time (desc)
  const pages = source
    .getPages(lang)
    .filter((p: any) => !(p?.data as any)?.noindex)
    .sort((a: any, b: any) => {
      const ad = Date.parse((a.data as any).publishedAt ?? (a.data as any).updatedAt ?? "");
      const bd = Date.parse((b.data as any).publishedAt ?? (b.data as any).updatedAt ?? "");
      return (isNaN(bd) ? 0 : bd) - (isNaN(ad) ? 0 : ad);
    });

  return (
    <DocsPage full>
      <DocsTitle>{t("title")}</DocsTitle>
      <DocsDescription>{t("intro")}</DocsDescription>
      <DocsBody>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {pages.map((page: any) => {
            const fm: any = page.data ?? {};
            const published = fm.publishedAt ?? fm.updatedAt;
            const tags: string[] = Array.isArray(fm.tags)
              ? fm.tags
              : typeof fm.tags === "string"
              ? fm.tags.split(",").map((s: string) => s.trim()).filter(Boolean)
              : [];
            return (
              <article
                key={page.url}
                className="group relative flex flex-col overflow-hidden rounded-lg border bg-background p-5 transition hover:shadow-md"
              >
                <div className="flex-1">
                  <h3 className="text-lg font-semibold tracking-tight group-hover:text-primary">
                    {fm.title}
                  </h3>
                  {published ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(published).toLocaleDateString(lang, {
                        year: "numeric",
                        month: "short",
                        day: "2-digit",
                      })}
                    </p>
                  ) : null}
                  {fm.description ? (
                    <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
                      {fm.description}
                    </p>
                  ) : null}
                </div>
                {tags.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {tags.map((tag: string) => (
                      <span
                        key={tag}
                        className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <Link href={page.url} className="absolute inset-0" aria-label={fm.title}>
                  <span className="sr-only">{fm.title}</span>
                </Link>
              </article>
            );
          })}
        </div>
      </DocsBody>
    </DocsPage>
  );
}
