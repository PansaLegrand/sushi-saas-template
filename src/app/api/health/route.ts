import { NextResponse } from "next/server";
import { EnvValidationError, validateAppEnv } from "@/lib/env";

export async function GET() {
  try {
    validateAppEnv();
  } catch (error) {
    const details =
      error instanceof EnvValidationError ? error.issues : ["unknown env error"];
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        checks: {
          env: "error",
        },
        details,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    checks: {
      env: "ok",
    },
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
