import { headers } from "next/headers";

import { listOrgReservationsWithService } from "@/models/reservation";
import { ReservationsConfig } from "@/config/reservations";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { getOrgContextFromHeaders } from "@/services/authz";

export async function GET() {
  if (!ReservationsConfig.enabled) return respCode("RESOURCE_NOT_FOUND");

  try {
    // Resolves the session and the acting organization together. The previous
    // version read `session.user.uuid` directly, which skipped the id-to-uuid
    // fallback in the user service and had no tenant scope at all.
    const ctx = await getOrgContextFromHeaders(await headers());
    if (!ctx) return respCode("AUTH_REQUIRED");

    const list = await listOrgReservationsWithService(ctx.orgUuid);
    return respData({ reservations: list });
  } catch (error) {
    return respError(error, {
      logFields: { event: "reservation.mine_failed" },
      fallback: "RESERVATION_AVAILABILITY_FAILED",
    });
  }
}
