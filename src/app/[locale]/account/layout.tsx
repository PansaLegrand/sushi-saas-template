import { headers } from "next/headers";
import { redirect } from "next/navigation";

import AccountShell from "@/components/account/account-shell";
import { ReservationsConfig } from "@/config/reservations";
import { localePath } from "@/i18n/locale";
import { getOrgNavigationStateFromHeaders } from "@/services/authz";

export default async function AccountLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const [{ locale }, navigation] = await Promise.all([
    params,
    getOrgNavigationStateFromHeaders(await headers()),
  ]);

  if (!navigation) redirect(localePath(locale, "/login"));

  return (
    <AccountShell
      navigation={navigation}
      reservationsEnabled={ReservationsConfig.enabled}
    >
      {children}
    </AccountShell>
  );
}
