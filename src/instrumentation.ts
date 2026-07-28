import { validateAppEnv } from "@/lib/env";
import { logger } from "@/lib/logger/server";

/**
 * Validate production configuration when the server process boots, before the
 * first customer request can discover a missing Stripe price or secret.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      validateAppEnv();
    } catch (error) {
      // Next logs a rejected instrumentation hook but can leave the HTTP
      // listener alive. Exit explicitly so containers and process managers see
      // a failed deployment instead of routing traffic to a broken instance.
      logger.error(
        { err: error, event: "app.environment_invalid" },
        "fatal environment configuration"
      );
      process.exit(1);
    }
  }
}
