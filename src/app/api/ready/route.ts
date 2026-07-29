import { getReadinessReport } from "@/services/readiness";

/** Dependency readiness. Keep `/api/health` as the cheap liveness endpoint. */
export async function GET() {
  const report = await getReadinessReport();

  return Response.json(
    {
      status: report.ready ? "ok" : "error",
      timestamp: new Date().toISOString(),
      ...report,
    },
    { status: report.ready ? 200 : 503 }
  );
}
