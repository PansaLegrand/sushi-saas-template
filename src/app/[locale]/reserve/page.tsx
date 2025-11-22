import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { buildMetadata, defaultMetaFallbacks } from "@/lib/seo";
import { ensureDemoService, listActiveServices, findReservationByNo, getServiceById } from "@/features/reservations/models";
import { buildGoogleCalendarUrl } from "@/features/reservations/google";
import { ReservationsConfig } from "@/features/reservations/config";
import ReservationWidget from "@/features/reservations/components/reservation-widget";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tMeta = await getTranslations();
  const tReservation = await getTranslations("reservation");
  const keywords =
    typeof (tMeta as any).raw === "function"
      ? (tMeta as any).raw("metadata.keywords")
      : (tMeta as any)("metadata.keywords");

  return buildMetadata({
    locale,
    path: "/reserve",
    title: `Reserve | ${tMeta("metadata.title") || defaultMetaFallbacks.title}`,
    description:
      tReservation("subtitle") ||
      tMeta("metadata.description") ||
      defaultMetaFallbacks.description,
    keywords,
  });
}

export const dynamic = "force-dynamic";

export default async function ReservePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams?: Promise<{ [k: string]: string | string[] | undefined }> }) {
  if (!ReservationsConfig.enabled) return notFound();

  const t = await getTranslations("reservation");
  const { locale } = await params;

  if (ReservationsConfig.autoSeedDemo) {
    try { await ensureDemoService(); } catch {}
  }
  const services = await listActiveServices();

  const sp = (await searchParams) ?? {};
  const success = sp?.success === "1" || sp?.success === "true";
  const reservationNo = typeof sp?.reservation_no === "string" ? sp.reservation_no : undefined;
  let googleUrl: string | null = null;
  if (success && reservationNo) {
    try {
      const r = await findReservationByNo(reservationNo);
      if (r) {
        const svc = await getServiceById(r.service_id);
        const start = new Date(r.start_at as any);
        const end = new Date(r.end_at as any);
        googleUrl = buildGoogleCalendarUrl({
          title: `Reservation: ${svc?.title ?? "Service"}`,
          start,
          end,
          description: `Reservation #${reservationNo}`,
          timeZone: ReservationsConfig.baseTimeZone,
        });
      }
    } catch {}
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-semibold">{t("title")}</h1>
      <p className="mb-8 text-sm text-muted-foreground">{t("subtitle")}</p>
      {success ? (
        <div className="mb-6 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          <div>Reservation confirmed{reservationNo ? ` (#${reservationNo})` : ""}. Check your email for details.</div>
          {googleUrl ? (
            <a href={googleUrl} className="mt-2 inline-block underline" target="_blank" rel="noreferrer">Add to Google Calendar</a>
          ) : null}
        </div>
      ) : null}
      <ReservationWidget services={services} locale={locale} />
    </main>
  );
}
