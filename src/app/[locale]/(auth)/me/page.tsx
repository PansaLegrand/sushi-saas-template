import { redirect } from "next/navigation";
import { localePath } from "@/i18n/locale";
export const metadata = { robots: { index: false, follow: false } };
/** Preserve existing admin MFA/setup links while keeping one account surface. */
export default async function ProfileAlias({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ org?: string }> }) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const org = typeof query.org === "string" ? `?org=${encodeURIComponent(query.org)}` : "";
  redirect(`${localePath(locale, "/account/profile")}${org}`);
}
