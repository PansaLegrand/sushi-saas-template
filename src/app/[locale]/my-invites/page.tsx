import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { AffiliateConfig } from "@/data/affiliate";
import { findUserByEmail, findUserByUuid } from "@/models/user";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import { getAffiliateSummary, getAffiliatesByUserUuid } from "@/models/affiliate";
import InviteLink from "@/components/affiliate/invite-link";
import AffiliateSummaryCards from "@/components/affiliate/summary-cards";
import AffiliateTable from "@/components/affiliate/affiliate-table";

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
    path: "/my-invites",
    title: `My Invites | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description: tMeta("metadata.description") || defaultMetaFallbacks.description,
    keywords,
    noindex: true,
  });
}

function toShareUrl(code: string): string {
  const base = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";
  return `${base}${AffiliateConfig.sharePath}/${code}`;
}

async function getSession() {
  const h = await headers();
  return auth.api.getSession({ headers: h });
}

export default async function MyInvitesPage({ params }: { params: Promise<{ locale: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { locale } = await params;

  // Resolve user uuid (Better Auth may not include it in session payload in some setups)
  const email = (session.user?.email as string) || "";
  let userUuid = (session.user as any)?.uuid as string | undefined;
  if (!userUuid && email) {
    const user = await findUserByEmail(email);
    userUuid = user?.uuid;
  }
  if (!userUuid) redirect("/login");

  const [dbUser, summary, rows] = await Promise.all([
    findUserByUuid(userUuid),
    getAffiliateSummary(userUuid),
    getAffiliatesByUserUuid(userUuid, 1, 50),
  ]);

  const inviteCode = dbUser?.invite_code ?? "";
  const shareUrl = inviteCode ? toShareUrl(inviteCode) : undefined;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">My Invites</h1>
        <p className="text-sm text-muted-foreground">Share your link and track your rewards.</p>
      </header>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-medium">Invite Link</h2>
        <InviteLink initialInviteCode={inviteCode} initialShareUrl={shareUrl} />
      </section>

      <section className="space-y-4 rounded-lg border p-4">
        <h2 className="text-lg font-medium">Summary</h2>
        <AffiliateSummaryCards summary={summary} />
      </section>

      <section className="space-y-4 rounded-lg border p-4">
        <h2 className="text-lg font-medium">Activity</h2>
        <AffiliateTable rows={rows ?? []} />
      </section>
    </main>
  );
}
