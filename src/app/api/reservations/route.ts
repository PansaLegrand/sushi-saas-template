import { ReservationsConfig } from "@/features/reservations/config";
import { createReservationAndCheckout } from "@/features/reservations/service";
import { getUserUuid } from "@/services/user";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respNoAuth } from "@/lib/resp";
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
    const user_uuid = await getUserUuid(req);
    if (!user_uuid) return respNoAuth();

    const body = await req.json().catch(() => null);
    if (!body) {
      return respCode("REQUEST_MALFORMED_JSON");
    }

    const service_id = Number(body.service_id);
    const start_at = String(body.start_at);
    const timezone = String(body.timezone);
    const contact_email = body.contact_email ? String(body.contact_email) : undefined;
    const contact_phone = body.contact_phone ? String(body.contact_phone) : undefined;
    const notes = body.notes ? String(body.notes) : undefined;
    const locale = String(body.locale || "en");

    if (!service_id || !start_at || !timezone) {
      return respCode("REQUEST_MISSING_FIELD");
    }

    const result = await createReservationAndCheckout({
      locale,
      user_uuid,
      service_id,
      start_at,
      timezone,
      contact_email,
      contact_phone,
      notes,
    });

    return respData(result);
  } catch (error) {
    return respError(error, {
      logFields: { event: "reservation.create_failed" },
      fallback: "RESERVATION_CREATE_FAILED",
    });
  }
}
