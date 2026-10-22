import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { localePath } from "@/i18n/locale";
import { getAccountActorFromHeaders } from "@/services/account-lifecycle";
import { getAccountSettings } from "@/services/account-settings";
import { ProfileSettings } from "@/components/account/profile-settings";
export const metadata = { robots: { index: false, follow: false } };
export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const actor = await getAccountActorFromHeaders(await headers());
  if (!actor) redirect(localePath(locale, "/login"));
  const [initial, t] = await Promise.all([getAccountSettings(actor), getTranslations("account.settings")]);
  return <main className="mx-auto max-w-3xl space-y-8 px-4 py-12"><header className="space-y-2"><h1 className="text-3xl font-semibold">{t("title")}</h1><p className="text-sm text-muted-foreground">{t("description")}</p></header><ProfileSettings key={actor.userUuid} initial={initial} /></main>;
}
