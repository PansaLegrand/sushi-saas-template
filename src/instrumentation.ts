import type { Instrumentation } from "next";

import { validateAppEnv } from "@/lib/env";
import { logger } from "@/lib/logger/server";

/**
 * Validate production configuration when the server process boots, before the
 * first customer request can discover a missing Stripe price or secret.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      validateAppEnv();
    } catch (error) {
      // Next logs a rejected instrumentation hook but can leave the HTTP
      // listener alive. Exit explicitly so containers and process managers see
      // a failed deployment instead of routing traffic to a broken instance.
      logger.error(
        { err: error, event: "app.environment_invalid" },
        "fatal environment configuration",
      );
      process.exit(1);
    }

    if (
      ["1", "true", "yes", "on"].includes(
        (process.env.OTEL_ENABLED ?? "").trim().toLowerCase(),
      )
    ) {
      const { registerOTel } = await import("@vercel/otel");
      registerOTel({
        serviceName:
          process.env.OTEL_SERVICE_NAME?.trim() ||
          process.env.NEXT_PUBLIC_PROJECT_NAME?.trim() ||
          "saas-app",
      });
      logger.info(
        { event: "observability.registered", exporter: "otlp" },
        "OpenTelemetry tracing registered",
      );
    }
  }
}

/** Render and route errors that never cross an API `catch` still leave a trace. */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  logger.error(
    {
      err: error,
      event: "next.request_error",
      error_digest:
        error && typeof error === "object" && "digest" in error
          ? String(error.digest)
          : undefined,
      method: request.method,
      path: request.path,
      route: context.routePath,
      route_type: context.routeType,
      router_kind: context.routerKind,
      render_source: context.renderSource,
    },
    "Next.js request failed",
  );
};
