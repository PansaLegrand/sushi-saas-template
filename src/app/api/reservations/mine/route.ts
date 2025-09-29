import { listUserReservationsWithService } from "@/features/reservations/models";
import { ReservationsConfig } from "@/features/reservations/config";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function GET() {
  if (!ReservationsConfig.enabled) return new Response("not found", { status: 404 });
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) return new Response("unauthorized", { status: 401 });
  const user = session.user as any;
  const uuid: string | undefined = user?.uuid;
  if (!uuid) return new Response("unauthorized", { status: 401 });
  const list = await listUserReservationsWithService(uuid);
  return Response.json({ reservations: list });
}

