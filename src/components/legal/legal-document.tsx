import { getTranslations } from "next-intl/server";

import { LegalConfig, type LegalDocument } from "@/config/legal";

/**
 * Renders a document from `src/config/legal.ts`.
 *
 * A server component with no interactivity: legal text is read, not used. The
 * unreviewed-draft notice is not dismissible and is not styled to be ignorable,
 * because shipping the skeleton as if it were a policy is the specific failure
 * this page exists to prevent.
 */
export async function LegalDocumentView({
  document,
}: {
  document: LegalDocument;
}) {
  const t = await getTranslations("legal.document");

  return (
    <article className="container max-w-3xl py-16 md:py-24">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          {document.title}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {t("effective", { date: document.effectiveDate })}
        </p>
      </header>

      {!LegalConfig.isConfigured ? (
        <div
          role="note"
          className="mt-8 rounded-md border border-warning/50 bg-warning/10 p-4 text-sm leading-relaxed"
        >
          <p className="font-medium">{t("draftNotice.title")}</p>
          <p className="mt-2 text-muted-foreground">{t("draftNotice.body")}</p>
        </div>
      ) : null}

      <div className="mt-12 space-y-10">
        {document.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-lg font-semibold tracking-tight">
              {section.heading}
            </h2>
            <div className="mt-3 space-y-3">
              {section.body.map((paragraph, index) => (
                <p
                  key={index}
                  className="text-sm leading-relaxed text-muted-foreground"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
