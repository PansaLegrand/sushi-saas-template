import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import InvitationActions from "@/components/team/invitation-actions";
import { Button } from "@/components/ui/button";
import { localePath } from "@/i18n/locale";
import { auth } from "@/lib/auth";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import { findInvitationById } from "@/models/organization";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale } = await params;
  const tMeta = await getTranslations();

  return buildMetadata({
    locale,
    path: "/invitations",
    title: `Invitation | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description: tMeta("metadata.description") || defaultMetaFallbacks.description,
    // Never indexed: the URL is a bearer credential.
    noindex: true,
  });
}

/**
 * The landing page for an invitation link.
 *
 * Renders the same "invalid or expired" outcome for a missing, used, and
 * expired invitation. Distinguishing them would let anyone with a guessed id
 * learn whether it corresponds to a real team.
 */
export default async function InvitationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;

  const invitation = await findInvitationById(id);
  if (
    !invitation ||
    invitation.status !== "pending" ||
    invitation.expires_at.getTime() <= Date.now()
  ) {
    notFound();
  }

  const t = await getTranslations("team.invitation");
  const session = await auth.api.getSession({ headers: await headers() });
  const signedInAs = session?.user.email?.toLowerCase();
  const matchesInvitee = signedInAs === invitation.email.toLowerCase();

  return (
    <main className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-lg flex-col justify-center gap-6 px-4 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">
          {t("title", { name: invitation.organization.name })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("body", { name: invitation.organization.name })}
        </p>
      </header>

      {matchesInvitee ? (
        <InvitationActions id={id} organizationName={invitation.organization.name} />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("signInFirst")}</p>
          <Button asChild>
            {/* The invitation is bound to the invited address, so send them to
                sign in and come straight back to this link. */}
            <Link
              href={localePath(
                locale,
                `/login?callbackUrl=${encodeURIComponent(
                  localePath(locale, `/invitations/${id}`)
                )}`
              )}
            >
              {t("signIn")}
            </Link>
          </Button>
        </div>
      )}
    </main>
  );
}
