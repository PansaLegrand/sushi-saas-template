import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import TwoFactorVerifyForm from "@/components/auth/two-factor-verify-form";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tMeta = await getTranslations();
  const keywords =
    typeof (tMeta as any).raw === "function"
      ? (tMeta as any).raw("metadata.keywords")
      : (tMeta as any)("metadata.keywords");

  return buildMetadata({
    locale,
    path: "/two-factor",
    title: `Two-factor | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description: tMeta("metadata.description") || defaultMetaFallbacks.description,
    keywords,
    noindex: true,
  });
}

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const [t, query] = await Promise.all([
    getTranslations("auth"),
    searchParams,
  ]);
  const callbackUrl = Array.isArray(query.callbackUrl)
    ? query.callbackUrl[0]
    : query.callbackUrl;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <section className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">{t("twoFactorTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("twoFactorSubtitle")}
          </p>
        </header>
        <TwoFactorVerifyForm callbackUrl={callbackUrl} />
      </section>
    </main>
  );
}
