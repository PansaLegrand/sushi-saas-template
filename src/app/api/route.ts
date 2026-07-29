import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    message:
      "Service online. Use /api/health for liveness and /api/ready for dependency readiness.",
  });
}
