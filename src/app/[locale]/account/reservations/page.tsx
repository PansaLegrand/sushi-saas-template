import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
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
  const tMeta = await getTranslations();
  const keywords =
    typeof (tMeta as any).raw === "function"
      ? (tMeta as any).raw("metadata.keywords")
      : (tMeta as any)("metadata.keywords");

  return buildMetadata({
    locale,
    path: "/account/reservations",
    title: `My Reservations | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description: tMeta("metadata.description") || defaultMetaFallbacks.description,
    keywords,
    noindex: true,
  });
}

async function getSession() {
  const h = await headers();
  return auth.api.getSession({ headers: h });
}

export default async function MyReservationsPage() {
  if (!ReservationsConfig.enabled) redirect("/");
  // Resolves session and tenant in one call. The previous version fell back to
  // looking the account up by email, which `users` only makes unique per
  // sign-in provider — so a person with both a password and a Google account
  // could be resolved to the wrong row.
  const ctx = await getOrgContextFromHeaders(await headers());
  if (!ctx) redirect("/login");

  const reservations = await listOrgReservationsWithService(ctx.orgUuid);
  const sorted = reservations.sort((a, b) => new Date(a.start_at as any).getTime() - new Date(b.start_at as any).getTime());

  return (
    <main className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-3xl flex-col gap-8 px-4 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">My Reservations</h1>
        <p className="text-sm text-muted-foreground">View upcoming and past reservations.</p>
      </header>

      <section className="space-y-3 rounded-lg border border-border bg-card p-6 shadow-sm">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no reservations yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sorted.map((r) => {
              const d = new Date(r.start_at as any);
              const when = d.toLocaleString();
              const start = new Date(r.start_at as any);
              const end = new Date(r.end_at as any);
              const gUrl = buildGoogleCalendarUrl({
                title: `Reservation: ${r.service?.title ?? `Service #${r.service_id}`}`,
                start,
                end,
                description: `Reservation #${r.reservation_no}`,
                timeZone: ReservationsConfig.baseTimeZone,
              });
              return (
                <li key={r.reservation_no} className="flex items-center justify-between py-3">
                  <div className="space-y-1">
                    <p className="font-medium">{r.service?.title ?? `Service #${r.service_id}`}</p>
                    <p className="text-sm text-muted-foreground">{when} · {r.timezone}</p>
                    <a href={gUrl} className="text-xs text-blue-600 underline" target="_blank" rel="noreferrer">Add to Google Calendar</a>
                  </div>
                  <span className="rounded-full border px-3 py-1 text-xs capitalize text-muted-foreground">{r.status}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
