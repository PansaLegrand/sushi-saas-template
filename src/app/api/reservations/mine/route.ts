import { listUserReservationsWithService } from "@/models/reservation";
import { ReservationsConfig } from "@/config/reservations";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";

export async function GET() {
  if (!ReservationsConfig.enabled) return respCode("RESOURCE_NOT_FOUND");

  try {
    const h = await headers();
    const session = await auth.api.getSession({ headers: h });
    if (!session) return respCode("AUTH_REQUIRED");
    const user = session.user as any;
    const uuid: string | undefined = user?.uuid;
    if (!uuid) return respCode("AUTH_REQUIRED");
    const list = await listUserReservationsWithService(uuid);
    return respData({ reservations: list });
  } catch (error) {
    return respError(error, {
      logFields: { event: "reservation.mine_failed" },
      fallback: "RESERVATION_AVAILABILITY_FAILED",
    });
  }
}
