import { ReservationsConfig } from "@/config/reservations";
import { listReservationServices } from "@/services/reservations";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";

export async function GET() {
  if (!ReservationsConfig.enabled) {
    return respCode("RESOURCE_NOT_FOUND");
  }

  try {
    const services = await listReservationServices();
    return respData({ services });
  } catch (error) {
    return respError(error, {
      logFields: { event: "reservation.services_failed" },
      fallback: "RESERVATION_AVAILABILITY_FAILED",
    });
  }
}
