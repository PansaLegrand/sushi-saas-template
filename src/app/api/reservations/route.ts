import { z } from "zod";

import { ReservationsConfig } from "@/config/reservations";
import { createReservationAndCheckout } from "@/services/reservations";
import { getOrgContext } from "@/services/authz";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";

const CreateReservationSchema = z.object({
  service_id: z.coerce.number().int().positive(),
  start_at: z.string().trim().min(1),
  timezone: z.string().trim().min(1).max(64),
  contact_email: z.string().trim().email().max(255).optional(),
  contact_phone: z.string().trim().max(64).optional(),
  notes: z.string().trim().max(2_000).optional(),
  locale: z.string().trim().min(2).max(50).default("en"),
});

const CheckoutIntentSchema = z.string().trim().uuid();

export async function POST(req: Request) {
  if (!ReservationsConfig.enabled) {
    return respCode("RESOURCE_NOT_FOUND");
  }
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "checkout");
  if (limited) return limited;

  try {
    const ctx = await getOrgContext(req);
    if (!ctx) return respNoAuth();

    const body = await parseJsonBody(req, CreateReservationSchema);
    const rawCheckoutIntentId = req.headers.get("idempotency-key");
    if (!rawCheckoutIntentId) {
      return respCode("REQUEST_MISSING_FIELD", {
        details: { field: "Idempotency-Key" },
      });
    }
    const checkoutIntent = CheckoutIntentSchema.safeParse(
      rawCheckoutIntentId
    );
    if (!checkoutIntent.success) {
      return respCode("REQUEST_VALIDATION_FAILED", {
        details: {
          fields: [
            {
              field: "Idempotency-Key",
              code: checkoutIntent.error.issues[0]?.code,
            },
          ],
        },
      });
    }

    const result = await createReservationAndCheckout({
      locale: body.locale,
      org_uuid: ctx.orgUuid,
      user_uuid: ctx.userUuid,
      service_id: body.service_id,
      start_at: body.start_at,
      timezone: body.timezone,
      checkout_intent_id: checkoutIntent.data,
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
