import { ReservationsConfig } from "@/features/reservations/config";
import { getAvailabilityForDate } from "@/features/reservations/service";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";

export async function POST(req: Request) {
  if (!ReservationsConfig.enabled) {
    return respCode("RESOURCE_NOT_FOUND");
  }
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "checkout");
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return respCode("REQUEST_MALFORMED_JSON");
    }

    const service_id = Number(body.service_id);
    const date: string = body.date; // YYYY-MM-DD
    const timezone: string = body.timezone;

    if (!service_id || !date || !timezone) {
      return respCode("REQUEST_MISSING_FIELD");
    }

    const slots = await getAvailabilityForDate({
      service_id,
      dateISO: date,
      timezone,
    });

    return respData({ slots });
  } catch (error) {
    return respError(error, {
      logFields: { event: "reservation.availability_failed" },
      fallback: "RESERVATION_AVAILABILITY_FAILED",
    });
  }
}
