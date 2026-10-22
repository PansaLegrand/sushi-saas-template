import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { localePath } from "@/i18n/locale";
import { getOrgContextFromHeaders } from "@/services/authz";
import { findTaskByUuid, findTaskByIdempotencyKey } from "@/models/task";
import { toTaskRecord } from "@/services/tasks/presentation";

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

export default async function ImageGenerationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ org?: string; task?: string; intent?: string }>;
}) {
  if (!isImageGenerationMockEnabled()) notFound();
  const [{ locale }, query, ctx] = await Promise.all([
    params,
    searchParams,
    getOrgContextFromHeaders(await headers()),
  ]);
  if (!ctx) {
    const resume = new URLSearchParams();
    for (const key of ["org", "task", "intent"] as const) {
      const value = query[key];
      if (typeof value === "string" && value.length <= 255)
        resume.set(key, value);
    }
    const callback = `${localePath(locale, "/tasks/image-generation")}?${resume}`;
    redirect(
      `${localePath(locale, "/login")}?callbackUrl=${encodeURIComponent(callback)}`,
    );
  }
  if (!query.org) {
    const next = new URLSearchParams({ org: ctx.orgSlug });
    if (typeof query.task === "string") next.set("task", query.task);
    if (typeof query.intent === "string") next.set("intent", query.intent);
    redirect(`${localePath(locale, "/tasks/image-generation")}?${next}`);
  }
  const taskId =
    typeof query.task === "string" && query.task.length <= 255
      ? query.task
      : undefined;
  const intent =
    typeof query.intent === "string" && query.intent.length <= 255
      ? query.intent
      : undefined;
  const row = taskId
    ? await findTaskByUuid(taskId, ctx.orgUuid)
    : intent
      ? await findTaskByIdempotencyKey({
          org_uuid: ctx.orgUuid,
          user_uuid: ctx.userUuid,
          type: "image_generation",
          idempotency_key: intent,
        })
      : undefined;
  if ((taskId && !row) || (row && row.type !== "image_generation")) notFound();
  const initialTask = row ? await toTaskRecord(row) : null;
  const t = await getTranslations("tasks.imageGeneration");

  return (
    <main className="container mx-auto flex max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("intro")}</p>
      </header>
      <ImageGenerationForm
        key={ctx.orgUuid}
        initialTask={initialTask}
        initialIntentKey={intent}
        persistenceKey={`image-task:${ctx.userUuid}:${ctx.orgUuid}`}
      />
    </main>
  );
}
