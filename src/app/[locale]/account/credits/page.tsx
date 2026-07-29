import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import { getOrgContextFromHeaders } from "@/services/authz";
import { getOrgCreditSummary } from "@/services/credit";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [tMeta, t] = await Promise.all([
    getTranslations(),
    getTranslations("account.credits"),
  ]);

  return buildMetadata({
    locale,
    path: "/account/credits",
    title: `${t("title")} | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description:
      tMeta("metadata.description") || defaultMetaFallbacks.description,
    keywords: tMeta.raw("metadata.keywords"),
    noindex: true,
  });
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function transactionLabelKey(type: string): string {
  switch (type) {
    case "new_user":
      return "types.newUser";
    case "order_pay":
      return "types.purchase";
    case "system_add":
      return "types.adjustment";
    case "task_text_to_video":
      return "types.videoTask";
    case "task_adjust":
      return "types.refund";
    case "ping":
    case "mock_usage":
      return "types.usage";
    default:
      return "types.other";
  }
}

export default async function CreditsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const requestHeaders = await headers();
  const ctx = await getOrgContextFromHeaders(requestHeaders);
  if (!ctx) redirect("/login");

  const { locale } = await params;
  const [summary, t] = await Promise.all([
    getOrgCreditSummary(ctx.orgUuid, {
      includeLedger: true,
      includeExpiring: true,
      ledgerLimit: 100,
    }),
    getTranslations("account.credits"),
  ]);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-4xl flex-col gap-8 px-4 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("subtitle", { workspace: ctx.orgName })}
        </p>
      </header>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["balance", summary.balance],
          ["granted", summary.granted],
          ["consumed", summary.consumed],
          ["expired", summary.expired],
        ].map(([key, value]) => (
          <div
            key={key}
            className="rounded-lg border border-border bg-card p-5 shadow-sm"
          >
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t(`summary.${key}`)}
            </dt>
            <dd className="mt-2 text-2xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      {summary.expiringSoon.length > 0 ? (
        <section
          aria-labelledby="expiring-credits-title"
          className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <h2 id="expiring-credits-title" className="font-semibold">
            {t("expiringTitle")}
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {summary.expiringSoon.map((entry) => (
              <li
                key={entry.transNo}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>{t("creditValue", { value: entry.credits })}</span>
                <span>{formatDate(entry.expiredAt, locale)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="credit-history-title" className="space-y-4">
        <div>
          <h2 id="credit-history-title" className="text-xl font-semibold">
            {t("historyTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("historyDescription")}
          </p>
        </div>

        {summary.ledger.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            {t("noHistory")}
          </div>
        ) : (
          <div
            role="region"
            aria-label={t("historyTableLabel")}
            tabIndex={0}
            className="overflow-x-auto rounded-lg border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <table className="w-full min-w-[42rem] text-left text-sm">
              <caption className="sr-only">{t("historyTableLabel")}</caption>
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    {t("columns.date")}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t("columns.type")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    {t("columns.change")}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t("columns.expires")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summary.ledger.map((entry) => (
                  <tr key={entry.transNo}>
                    <td className="whitespace-nowrap px-4 py-3">
                      {formatDate(entry.createdAt, locale)}
                    </td>
                    <td className="px-4 py-3">
                      {t(transactionLabelKey(entry.transType))}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-medium ${
                        entry.credits > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-foreground"
                      }`}
                    >
                      {entry.credits > 0 ? "+" : ""}
                      {entry.credits}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatDate(entry.expiredAt, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
