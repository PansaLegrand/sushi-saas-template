import { AdminPageHeader } from "@admin/components/admin-page-header";
import { AdminPanel } from "@admin/components/admin-panel";
import { AdminStatusBadge } from "@admin/components/admin-status-badge";
import {
  AdminTable,
  AdminTableBody,
  AdminTableCell,
  AdminTableEmpty,
  AdminTableHead,
  AdminTableHeader,
  AdminTableRow,
} from "@admin/components/admin-table";
import { getAdminContext } from "@admin/lib/authz";
import {
  countAdminReservations,
  listAdminReservationsWithService,
} from "@admin/lib/data";
import { formatAdminDate } from "@admin/lib/format";
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
        <AdminPanel>
          <p className="text-sm text-muted-foreground">
            Reservations are disabled in the product configuration.
          </p>
        </AdminPanel>
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

      {/* Ordered by start time, so paging walks the calendar forward. */}
      <AdminTable caption="Customer reservations" className="min-w-[64rem]">
        <AdminTableHeader>
          <tr>
            <AdminTableHead>Reservation #</AdminTableHead>
            <AdminTableHead>Service</AdminTableHead>
            <AdminTableHead>User UUID</AdminTableHead>
            <AdminTableHead>When</AdminTableHead>
            <AdminTableHead>Timezone</AdminTableHead>
            <AdminTableHead>Status</AdminTableHead>
          </tr>
        </AdminTableHeader>
        <AdminTableBody>
          {reservations.length === 0 && (
            <AdminTableEmpty
              colSpan={6}
              title="No reservations"
              description="Customer appointments will appear here."
            />
          )}
          {reservations.map((reservation) => (
            <AdminTableRow key={reservation.id}>
              <AdminTableCell className="font-mono">
                {reservation.reservation_no}
              </AdminTableCell>
              <AdminTableCell className="font-medium">
                {reservation.service?.title ?? `#${reservation.service_id}`}
              </AdminTableCell>
              <AdminTableCell className="font-mono">
                {reservation.user_uuid}
              </AdminTableCell>
              <AdminTableCell className="whitespace-nowrap text-muted-foreground">
                {formatAdminDate(reservation.start_at)}
              </AdminTableCell>
              <AdminTableCell>{reservation.timezone}</AdminTableCell>
              <AdminTableCell>
                <AdminStatusBadge
                  tone={
                    reservation.status === "confirmed"
                      ? "success"
                      : reservation.status === "canceled" ||
                          reservation.status === "expired"
                        ? "danger"
                        : "info"
                  }
                >
                  {reservation.status}
                </AdminStatusBadge>
              </AdminTableCell>
            </AdminTableRow>
          ))}
        </AdminTableBody>
      </AdminTable>

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        unit="reservations"
        href={(target) => `/reservations?page=${target}`}
      />
    </div>
  );
}
