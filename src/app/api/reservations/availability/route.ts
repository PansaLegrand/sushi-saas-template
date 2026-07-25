import { z } from "zod";

import { ReservationsConfig } from "@/config/reservations";
import { getAvailabilityForDate } from "@/services/reservations";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";

const AvailabilitySchema = z.object({
  service_id: z.coerce.number().int().positive(),
  date: z.string().trim().min(1),
  timezone: z.string().trim().min(1),
});

export async function POST(req: Request) {
  if (!ReservationsConfig.enabled) {
    return respCode("RESOURCE_NOT_FOUND");
  }
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "checkout");
  if (limited) return limited;

  try {
    const body = await parseJsonBody(req, AvailabilitySchema);

    const slots = await getAvailabilityForDate({
      service_id: body.service_id,
      dateISO: body.date,
      timezone: body.timezone,
    });

    return respData({ slots });
  } catch (error) {
    return respError(error, {
      logFields: { event: "reservation.availability_failed" },
      fallback: "RESERVATION_AVAILABILITY_FAILED",
    });
  }
}
