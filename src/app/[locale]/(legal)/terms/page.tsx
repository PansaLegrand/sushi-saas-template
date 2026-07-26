import { getTranslations, setRequestLocale } from "next-intl/server";

import { buildMetadata } from "@/lib/seo";
import { buildTermsOfService } from "@/config/legal";
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
    path: "/terms",
    title: t("terms.title"),
    description: t("terms.description"),
  });
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <LegalDocumentView document={buildTermsOfService()} />;
}
