import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function DocsPage() {
  const t = await getTranslations("docs");
  return (
    <main className="container py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-4 text-muted-foreground">{t("intro")}</p>
        <div className="mt-8">
          <Link href="/" className="underline">
            {t("back")}
          </Link>
        </div>
      </div>
    </main>
  );
}

