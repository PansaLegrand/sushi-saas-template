import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import { isCreditsPlaygroundEnabled } from "@/lib/demo-flags";
import CreditTesterPage from "./client-page";

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
    path: "/credits-test",
    title: `Credits Test | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description: "Internal credits playground page for manual testing.",
    keywords,
    noindex: true,
  });
}

export default async function CreditsTestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (!isCreditsPlaygroundEnabled()) {
    notFound();
  }

  await params;
  return <CreditTesterPage />;
}
