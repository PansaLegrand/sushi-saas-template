import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/locale";
import { ACCOUNT_LIFECYCLE_POLICY } from "@/config/account-lifecycle";
import { getAccountActorFromHeaders, getAccountErasureStatus, getLatestAccountExport } from "@/services/account-lifecycle";
import { PrivacySettings } from "@/components/account/privacy-settings";
export const metadata = { robots: { index: false, follow: false } };
export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const actor = await getAccountActorFromHeaders(await headers());
  if (!actor) redirect(localePath(locale, "/login"));
  const [initialExport, initialDeletion, t] = await Promise.all([getLatestAccountExport(actor), getAccountErasureStatus(actor), getTranslations("account.privacy")]);
  return <main className="mx-auto max-w-3xl space-y-8 px-4 py-12"><header className="space-y-2"><h1 className="text-3xl font-semibold">{t("title")}</h1><p className="text-sm text-muted-foreground">{t("description")}</p></header><PrivacySettings key={actor.userUuid} email={actor.email} initialExport={initialExport} initialDeletion={initialDeletion} graceDays={ACCOUNT_LIFECYCLE_POLICY.erasureGracePeriodMs / 86_400_000} /></main>;
}
