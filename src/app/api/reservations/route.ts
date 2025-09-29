import { ReservationsConfig } from "@/features/reservations/config";
import { createReservationAndCheckout } from "@/features/reservations/service";
import { getUserUuid } from "@/services/user";

export async function POST(req: Request) {
  if (!ReservationsConfig.enabled) {
    return new Response("not found", { status: 404 });
  }
  try {
    const user_uuid = await getUserUuid(req);
    if (!user_uuid) return new Response("unauthorized", { status: 401 });

    const body = await req.json();
    const service_id = Number(body.service_id);
    const start_at = String(body.start_at);
    const timezone = String(body.timezone);
    const contact_email = body.contact_email ? String(body.contact_email) : undefined;
    const contact_phone = body.contact_phone ? String(body.contact_phone) : undefined;
    const notes = body.notes ? String(body.notes) : undefined;
    const locale = String(body.locale || "en");

    if (!service_id || !start_at || !timezone) {
      return new Response("invalid params", { status: 400 });
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

    return Response.json(result);
  } catch (e: any) {
    return new Response("error: " + e.message, { status: 500 });
  }
}

