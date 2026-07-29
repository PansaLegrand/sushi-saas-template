import { NextResponse } from "next/server";

/** Process liveness only. Dependency readiness lives at `/api/ready`. */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
}

export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: {
      "x-service-status": "ok",
    },
  });
}
