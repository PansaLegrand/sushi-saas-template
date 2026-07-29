import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listOrgReservationsWithService } from "@/models/reservation";
import { ReservationsConfig } from "@/config/reservations";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import { buildGoogleCalendarUrl } from "@/services/reservations/google";
import { getOrgContextFromHeaders } from "@/services/authz";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [tMeta, t] = await Promise.all([
    getTranslations(),
    getTranslations("account.reservations"),
  ]);
  const keywords =
    typeof (tMeta as any).raw === "function"
      ? (tMeta as any).raw("metadata.keywords")
      : (tMeta as any)("metadata.keywords");

  return buildMetadata({
    locale,
    path: "/account/reservations",
    title: `${t("title")} | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description:
      tMeta("metadata.description") || defaultMetaFallbacks.description,
    keywords,
    noindex: true,
  });
}

function reservationStatusKey(status: string): string {
  switch (status) {
    case "pending":
      return "statuses.pending";
    case "confirmed":
      return "statuses.confirmed";
    case "canceled":
      return "statuses.canceled";
    case "expired":
      return "statuses.expired";
    default:
      return "statuses.other";
  }
}

export default async function WorkspaceReservationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (!ReservationsConfig.enabled) redirect("/");
  // Resolves session and tenant in one call. The previous version fell back to
  // looking the account up by email, which `users` only makes unique per
  // sign-in provider — so a person with both a password and a Google account
  // could be resolved to the wrong row.
  const ctx = await getOrgContextFromHeaders(await headers());
  if (!ctx) redirect("/login");

  const { locale } = await params;
  const t = await getTranslations("account.reservations");
  const reservations = await listOrgReservationsWithService(ctx.orgUuid);
  const sorted = reservations.sort(
    (a, b) =>
      new Date(a.start_at as any).getTime() -
      new Date(b.start_at as any).getTime(),
  );

  return (
    <main className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-3xl flex-col gap-8 px-4 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("description", { workspace: ctx.orgName })}
        </p>
      </header>

      <section className="space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {sorted.map((r) => {
              const d = new Date(r.start_at as any);
              const when = d.toLocaleString(locale);
              const start = new Date(r.start_at as any);
              const end = new Date(r.end_at as any);
              const gUrl = buildGoogleCalendarUrl({
                title: t("calendarTitle", {
                  service:
                    r.service?.title ??
                    t("serviceFallback", { id: r.service_id }),
                }),
                start,
                end,
                description: t("calendarDescription", {
                  number: r.reservation_no,
                }),
                timeZone: ReservationsConfig.baseTimeZone,
              });
              return (
                <li
                  key={r.reservation_no}
                  className="flex flex-col items-start gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">
                      {r.service?.title ??
                        t("serviceFallback", { id: r.service_id })}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {when} · {r.timezone}
                    </p>
                    <a
                      href={gUrl}
                      className="inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("addToCalendar")}
                    </a>
                  </div>
                  <span className="shrink-0 rounded-full border px-3 py-1 text-xs capitalize text-muted-foreground">
                    {t(reservationStatusKey(r.status))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
