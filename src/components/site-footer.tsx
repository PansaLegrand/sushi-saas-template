import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { SiteConfig } from "@/config/site";
import { CookieSettingsButton } from "@/components/legal/cookie-settings-button";

/**
 * The site footer.
 *
 * Shared rather than inlined per page because the legal links are the reason it
 * exists: a privacy policy nobody can find is not a published privacy policy,
 * and payment processors check for these links during account review.
 */
export async function SiteFooter() {
  const t = await getTranslations("landing");
  const tLegal = await getTranslations("legal");

  return (
    <footer className="border-t border-border/60 py-8">
      <div className="container flex flex-col gap-4 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span>{t("footer")}</span>
          {SiteConfig.contactEmail ? (
            <a
              href={`mailto:${SiteConfig.contactEmail}`}
              className="underline-offset-4 transition hover:text-foreground hover:underline"
            >
              {SiteConfig.contactEmail}
            </a>
          ) : null}
        </div>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link
            href="/privacy"
            className="underline-offset-4 transition hover:text-foreground hover:underline"
          >
            {tLegal("nav.privacy")}
          </Link>
          <Link
            href="/terms"
            className="underline-offset-4 transition hover:text-foreground hover:underline"
          >
            {tLegal("nav.terms")}
          </Link>
          <CookieSettingsButton className="underline-offset-4 transition hover:text-foreground hover:underline" />
        </nav>
      </div>
    </footer>
  );
}
