import { ReservationsConfig } from "@/features/reservations/config";
import { ensureDemoService, listActiveServices } from "@/features/reservations/models";

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

