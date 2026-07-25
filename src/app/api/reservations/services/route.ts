import { ReservationsConfig } from "@/config/reservations";
import { ensureDemoService, listActiveServices } from "@/models/reservation";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";

export async function GET() {
  if (!ReservationsConfig.enabled) {
    return respCode("RESOURCE_NOT_FOUND");
  }

  try {
    // Seed a demo service if configured
    if (ReservationsConfig.autoSeedDemo) {
      try {
        await ensureDemoService();
      } catch {
        // ignore
      }
    }
    const services = await listActiveServices();
    return respData({ services });
  } catch (error) {
    return respError(error, {
      logFields: { event: "reservation.services_failed" },
      fallback: "RESERVATION_AVAILABILITY_FAILED",
    });
  }
}
