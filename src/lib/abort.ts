import { AppError } from "@/lib/errors";

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      message: "operation was canceled",
    });
  }
}
