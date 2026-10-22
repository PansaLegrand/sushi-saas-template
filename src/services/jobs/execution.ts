import { AppError } from "@/lib/errors";
import type { JobHandlerContext } from "./types";

/** Cancellation is cooperative; call this after awaits and before effects. */
export async function assertJobActive(
  context?: JobHandlerContext,
): Promise<void> {
  if (!context) return;
  if (context.signal.aborted)
    throw new AppError("SERVICE_UNAVAILABLE", {
      message: "job execution was aborted",
    });
  await context.assertActive?.();
  if (context.signal.aborted)
    throw new AppError("SERVICE_UNAVAILABLE", {
      message: "job execution was aborted",
    });
}
