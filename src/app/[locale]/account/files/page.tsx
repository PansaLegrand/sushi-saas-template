import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import Uploader from "@/components/storage/uploader";
import FilesList from "@/components/storage/files-list";
import { getOrgContextFromHeaders } from "@/services/authz";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [tMeta, t] = await Promise.all([
    getTranslations(),
    getTranslations("account.files"),
  ]);
  const keywords =
    typeof (tMeta as any).raw === "function"
      ? (tMeta as any).raw("metadata.keywords")
      : (tMeta as any)("metadata.keywords");

  return buildMetadata({
    locale,
    path: "/account/files",
    title: `${t("title")} | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description: tMeta("metadata.description") || defaultMetaFallbacks.description,
    keywords,
    noindex: true,
  });
}

export default async function FilesPage() {
  const ctx = await getOrgContextFromHeaders(await headers());
  if (!ctx) redirect("/login");
  const t = await getTranslations("account.files");

  return (
    <main className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-4xl flex-col gap-8 px-4 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("description", { workspace: ctx.orgName })}
        </p>
      </header>

      <section className="space-y-6 rounded-lg border border-border bg-card p-6 shadow-sm">
        <Uploader />
        <div className="border-t pt-6">
          <FilesList />
        </div>
      </section>
    </main>
  );
}
