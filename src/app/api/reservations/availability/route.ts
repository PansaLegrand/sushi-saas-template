import { ReservationsConfig } from "@/features/reservations/config";
import { getAvailabilityForDate } from "@/features/reservations/service";
import { rateLimitOrThrow } from "@/lib/rate-limit";

export async function POST(req: Request) {
  if (!ReservationsConfig.enabled) {
    return new Response("not found", { status: 404 });
  }
  const limited = rateLimitOrThrow(req, "checkout");
  if (limited) return limited;

  try {
    const body = await req.json();
    const service_id = Number(body.service_id);
    const date: string = body.date; // YYYY-MM-DD
    const timezone: string = body.timezone;

    if (!service_id || !date || !timezone) {
      return new Response("invalid params", { status: 400 });
    }

    const slots = await getAvailabilityForDate({
      service_id,
      dateISO: date,
      timezone,
    });

    return Response.json({ slots });
  } catch (e: any) {
    return new Response("error: " + e.message, { status: 500 });
  }
}
