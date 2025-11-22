import { getTranslations } from "next-intl/server";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import ForgotPasswordForm from "@/components/auth/forgot-password-form";

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
    path: "/forgot-password",
    title: `Forgot password | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description: tMeta("metadata.description") || defaultMetaFallbacks.description,
    keywords,
    noindex: true,
  });
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
