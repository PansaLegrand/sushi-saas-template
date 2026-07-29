import Pricing from "@/components/blocks/pricing";
import { getTranslations } from "next-intl/server";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import { getPricingPage } from "@/services/page";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";

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
    path: "/pricing",
    title: `Pricing | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description:
      tMeta("metadata.description") || defaultMetaFallbacks.description,
    keywords,
  });
}

export default async function PricingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ checkout?: string | string[] }>;
}) {
  const [{ locale }, query, t] = await Promise.all([
    params,
    searchParams,
    getTranslations("billing.checkout"),
  ]);
  const page = await getPricingPage(locale);
  const checkoutValue = Array.isArray(query.checkout)
    ? query.checkout[0]
    : query.checkout;
  const checkout =
    checkoutValue === "success" ||
    checkoutValue === "processing" ||
    checkoutValue === "failed"
      ? checkoutValue
      : null;
  const variant =
    checkout === "success"
      ? "success"
      : checkout === "processing"
        ? "warning"
        : "destructive";

  return (
    <main className="min-h-screen">
      {checkout ? (
        <div className="container pt-6">
          <Alert
            role={checkout === "failed" ? "alert" : "status"}
            variant={variant}
            className="mx-auto max-w-3xl"
          >
            <AlertTitle>{t(`${checkout}.title`)}</AlertTitle>
            <AlertDescription>
              {t(`${checkout}.description`)}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      {page.pricing ? <Pricing pricing={page.pricing} /> : null}
    </main>
  );
}
