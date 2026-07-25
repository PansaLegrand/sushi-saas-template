import { z } from "zod";

import { ReservationsConfig } from "@/config/reservations";
import { createReservationAndCheckout } from "@/services/reservations";
import { getUserUuid } from "@/services/user";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";

const CreateReservationSchema = z.object({
  service_id: z.coerce.number().int().positive(),
  start_at: z.string().trim().min(1),
  timezone: z.string().trim().min(1),
  contact_email: z.string().trim().optional(),
  contact_phone: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  locale: z.string().trim().default("en"),
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
    const user_uuid = await getUserUuid(req);
    if (!user_uuid) return respNoAuth();

    const body = await parseJsonBody(req, CreateReservationSchema);

    const result = await createReservationAndCheckout({
      locale: body.locale,
      user_uuid,
      service_id: body.service_id,
      start_at: body.start_at,
      timezone: body.timezone,
      contact_email: body.contact_email,
      contact_phone: body.contact_phone,
      notes: body.notes,
    });

    return respData(result);
  } catch (error) {
    return respError(error, {
      logFields: { event: "reservation.create_failed" },
      fallback: "RESERVATION_CREATE_FAILED",
    });
  }
}
