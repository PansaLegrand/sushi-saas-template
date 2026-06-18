import { getAdminContext } from "@/lib/authz";
import { listReservationsWithServiceAdmin } from "@/features/reservations/models";
import { ReservationsConfig } from "@/features/reservations/config";

export default async function AdminReservationsPage() {
  const admin = await getAdminContext();
  if (!admin || (admin.role !== "admin_ro" && admin.role !== "admin_rw")) {
    // Layout guards, but keep a server check
    return null;
  }
  if (!ReservationsConfig.enabled) {
    return (
      <section className="rounded-lg border p-4">
        <h2 className="mb-2 text-lg font-medium">Reservations</h2>
        <p className="text-sm text-muted-foreground">Feature disabled.</p>
      </section>
    );
  }

  const reservations = await listReservationsWithServiceAdmin(1, 50);

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 text-lg font-medium">Reservations (latest 50)</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-2 pr-4">Reservation #</th>
              <th className="py-2 pr-4">Service</th>
              <th className="py-2 pr-4">User UUID</th>
              <th className="py-2 pr-4">When</th>
              <th className="py-2 pr-4">TZ</th>
              <th className="py-2 pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((r) => {
              const when = new Date(r.start_at as any).toISOString();
              return (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-4 font-mono text-xs">{r.reservation_no}</td>
                  <td className="py-2 pr-4">{r.service?.title ?? `#${r.service_id}`}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{r.user_uuid}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{when}</td>
                  <td className="py-2 pr-4">{r.timezone}</td>
                  <td className="py-2 pr-4 capitalize">{r.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

