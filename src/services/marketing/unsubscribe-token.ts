import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { getAppEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

const PayloadSchema = z.object({
  version: z.literal(1),
  subscriptionUuid: z.string().uuid(),
  topic: z.string().min(1).max(64),
});

export type MarketingUnsubscribePayload = z.infer<typeof PayloadSchema>;

function secret(): string {
  const value = getAppEnv().MARKETING_UNSUBSCRIBE_SECRET;
  if (!value) {
    throw new AppError("SERVICE_UNAVAILABLE", {
      message: "MARKETING_UNSUBSCRIBE_SECRET is not configured",
    });
  }
  return value;
}

function signature(encodedPayload: string): string {
  return createHmac("sha256", secret())
    .update(encodedPayload)
    .digest("base64url");
}

export function createMarketingUnsubscribeToken(
  payload: Omit<MarketingUnsubscribePayload, "version">,
): string {
  const encodedPayload = Buffer.from(
    JSON.stringify({ version: 1, ...payload }),
    "utf8",
  ).toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

export function verifyMarketingUnsubscribeToken(
  token: string,
): MarketingUnsubscribePayload | null {
  const [encodedPayload, providedSignature, extra] = token.split(".");
  if (!encodedPayload || !providedSignature || extra) return null;

  const expected = Buffer.from(signature(encodedPayload), "utf8");
  const provided = Buffer.from(providedSignature, "utf8");
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
    const result = PayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
