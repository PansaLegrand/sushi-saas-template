import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    message: "Service online. For health details visit /api/health.",
  });
}
