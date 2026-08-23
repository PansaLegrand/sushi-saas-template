import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ImageGenerationForm } from "@/components/tasks/image-generation-form";
import { isImageGenerationMockEnabled } from "@/lib/demo-flags";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations();

  return buildMetadata({
    locale,
    path: "/tasks/image-generation",
    title: `${t("tasks.imageGeneration.title")} | ${t("metadata.title") || defaultMetaFallbacks.title}`,
    description:
      t("tasks.imageGeneration.intro") || defaultMetaFallbacks.description,
    keywords: t.raw("metadata.keywords"),
  });
}

export default async function ImageGenerationPage() {
  if (!isImageGenerationMockEnabled()) notFound();
  const t = await getTranslations("tasks.imageGeneration");

  return (
    <main className="container mx-auto flex max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("intro")}</p>
      </header>
      <ImageGenerationForm />
    </main>
  );
}
