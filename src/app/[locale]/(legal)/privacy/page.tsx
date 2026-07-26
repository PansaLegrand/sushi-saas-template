import { getTranslations, setRequestLocale } from "next-intl/server";

import { buildMetadata } from "@/lib/seo";
import { buildPrivacyPolicy } from "@/config/legal";
import { LegalDocumentView } from "@/components/legal/legal-document";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal" });

  return buildMetadata({
    locale,
    path: "/privacy",
    title: t("privacy.title"),
    description: t("privacy.description"),
  });
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <LegalDocumentView document={buildPrivacyPolicy()} />;
}
