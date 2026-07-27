import LocaleHomePage from "./[locale]/page";
import { setRequestLocale } from "next-intl/server";
import { defaultLocale } from "@/i18n/locale";

export default function RootPage() {
  setRequestLocale(defaultLocale);
  return <LocaleHomePage />;
}
