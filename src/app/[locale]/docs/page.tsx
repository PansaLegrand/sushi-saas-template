import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tMeta = await getTranslations();
  const tDocs = await getTranslations("docs");
  const keywords =
    typeof (tMeta as any).raw === "function"
      ? (tMeta as any).raw("metadata.keywords")
      : (tMeta as any)("metadata.keywords");

  return buildMetadata({
    locale,
    path: "/docs",
    title: `Docs | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description:
      tDocs("intro") || tMeta("metadata.description") || defaultMetaFallbacks.description,
    keywords,
  });
}

export default async function DocsPage() {
  const t = await getTranslations("docs");
  return (
    <main className="container py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-4 text-muted-foreground">{t("intro")}</p>
        <div className="mt-8">
          <Link href="/" className="underline">
            {t("back")}
          </Link>
        </div>
      </div>
    </main>
  );
}
