import { redirect } from "next/navigation";
import { defaultLocale } from "@/i18n/locale";

export default function RootPage() {
  // With localePrefix set to "always", we serve content under /:locale
  // Redirect visitors from "/" to the default locale landing.
  const target = `/${defaultLocale}`;
  redirect(target);
}
