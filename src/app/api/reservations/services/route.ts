import { ReservationsConfig } from "@/config/reservations";
import { ensureDemoService, listActiveServices } from "@/models/reservation";

export async function GET() {
  if (!ReservationsConfig.enabled) {
    return new Response("not found", { status: 404 });
  }
  // Seed a demo service if configured
  if (ReservationsConfig.autoSeedDemo) {
    try {
      await ensureDemoService();
    } catch {
      // ignore
    }
  }
  const services = await listActiveServices();
  return Response.json({ services });
}

