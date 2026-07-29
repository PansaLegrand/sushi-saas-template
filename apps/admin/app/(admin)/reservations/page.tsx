import { AdminPageHeader } from "@admin/components/admin-page-header";
import { getAdminContext } from "@admin/lib/authz";
import {
  countAdminReservations,
  listAdminReservationsWithService,
} from "@admin/lib/data";
import { Pager } from "@admin/components/pager";
import { ReservationsConfig } from "@/config/reservations";

const PAGE_SIZE = 50;

export default async function AdminReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const admin = await getAdminContext();
  if (!admin) {
    // Layout guards, but keep a server check
    return null;
  }
  if (!ReservationsConfig.enabled) {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="Reservations"
          description="Review upcoming and past customer appointments."
        />
        <section className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Feature disabled.</p>
        </section>
      </div>
    );
  }

  const { page: rawPage } = await searchParams;
  const page = Math.max(Number.parseInt(rawPage ?? "1", 10) || 1, 1);

  const [reservations, total] = await Promise.all([
    listAdminReservationsWithService(page, PAGE_SIZE),
    countAdminReservations(),
  ]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Reservations"
        description="Review upcoming and past customer appointments."
        actions={
          <p className="text-sm text-muted-foreground">Total: {total}</p>
        }
      />

      <section className="rounded-lg border p-4">
        {/* Ordered by start time, so paging walks the calendar forward rather
            than reading a "latest 50" that silently ended. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Customer reservations</caption>
            <thead className="text-left text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-4">
                  Reservation #
                </th>
                <th scope="col" className="py-2 pr-4">
                  Service
                </th>
                <th scope="col" className="py-2 pr-4">
                  User UUID
                </th>
                <th scope="col" className="py-2 pr-4">
                  When
                </th>
                <th scope="col" className="py-2 pr-4">
                  TZ
                </th>
                <th scope="col" className="py-2 pr-4">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {reservations.length === 0 && (
                <tr className="border-t">
                  <td className="p-3 text-muted-foreground" colSpan={6}>
                    No reservations.
                  </td>
                </tr>
              )}
              {reservations.map((r) => {
                const when = new Date(r.start_at as any).toISOString();
                return (
                  <tr key={r.id} className="border-t">
                    <td className="py-2 pr-4 font-mono text-xs">
                      {r.reservation_no}
                    </td>
                    <td className="py-2 pr-4">
                      {r.service?.title ?? `#${r.service_id}`}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {r.user_uuid}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{when}</td>
                    <td className="py-2 pr-4">{r.timezone}</td>
                    <td className="py-2 pr-4 capitalize">{r.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Pager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          unit="reservations"
          href={(target) => `/reservations?page=${target}`}
        />
      </section>
    </div>
  );
}
