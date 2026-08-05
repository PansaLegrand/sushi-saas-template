import config from "@payload-config";
import { getPayload } from "payload";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ContentPreview } from "@/components/content-preview";
import { LivePreviewListener } from "@/components/live-preview-listener";
import type { Page, Post } from "@/payload-types";

export const dynamic = "force-dynamic";

export default async function PreviewPage({
  params,
  searchParams
}: {
  params: Promise<{ collection: string; id: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const { collection: rawCollection, id } = await params;
  const { locale = "en" } = await searchParams;
  if (rawCollection !== "pages" && rawCollection !== "posts") notFound();

  const payload = await getPayload({ config });
  const requestHeaders = await headers();
  const auth = await payload.auth({ headers: requestHeaders });
  if (!auth.user || auth.user.collection !== "users") notFound();

  let document: Page | Post;
  try {
    document = (await payload.findByID({
      collection: rawCollection,
      id,
      draft: true,
      locale: locale as "en" | "zh" | "es" | "fr" | "ja",
      fallbackLocale: false,
      depth: 2,
      overrideAccess: false,
      user: auth.user
    })) as Page | Post;
  } catch {
    notFound();
  }

  return <><LivePreviewListener /><ContentPreview document={document} /></>;
}
