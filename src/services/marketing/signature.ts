import { createHmac, timingSafeEqual } from "node:crypto";

import { getAppEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export function signContentStudioRequest(
  body: string,
  timestamp: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export function requireContentStudioSignature(
  req: Request,
  body: string,
  now: Date = new Date(),
): void {
  const secret = getAppEnv().CONTENT_MARKETING_SECRET;
  if (!secret) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      message: "CONTENT_MARKETING_SECRET is not configured",
    });
  }

  const timestamp = req.headers.get("x-content-timestamp") ?? "";
  const signature = req.headers.get("x-content-signature") ?? "";
  const timestampSeconds = Number(timestamp);
  if (
    !Number.isInteger(timestampSeconds) ||
    Math.abs(Math.floor(now.getTime() / 1_000) - timestampSeconds) >
      MAX_CLOCK_SKEW_SECONDS ||
    !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    throw new AppError("AUTH_FORBIDDEN", {
      message: "invalid or stale Content Studio signature",
    });
  }

  const expected = signContentStudioRequest(body, timestamp, secret);
  const providedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new AppError("AUTH_FORBIDDEN", {
      message: "Content Studio signature did not match",
    });
  }
}
