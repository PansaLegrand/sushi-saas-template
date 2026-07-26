import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import TeamManager from "@/components/team/team-manager";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import { getOrgContextFromHeaders } from "@/services/authz";
import { getTeam } from "@/services/members";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tMeta = await getTranslations();

  return buildMetadata({
    locale,
    path: "/account/team",
    title: `Team | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description: tMeta("metadata.description") || defaultMetaFallbacks.description,
    noindex: true,
  });
}

export default async function TeamPage() {
  const requestHeaders = await headers();

  const ctx = await getOrgContextFromHeaders(requestHeaders);
  if (!ctx) redirect("/login");

  // A Server Component calls the service directly. Fetching our own
  // /api/account/team from here would turn an in-process call into an HTTP
  // round trip against ourselves — see the frontend rules in AGENTS.md.
  const team = await getTeam(ctx);
  const t = await getTranslations("team");

  return (
    <main className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-3xl flex-col gap-8 px-4 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("subtitle", { name: team.organization.name })}
        </p>
      </header>

      <TeamManager initial={team} />
    </main>
  );
}
