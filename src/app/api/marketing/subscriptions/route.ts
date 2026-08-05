import { NextRequest } from "next/server";

import { respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData } from "@/lib/resp";
import { MarketingSubscriptionRequestSchema } from "@/services/marketing/contracts";
import { subscribeToMarketing } from "@/services/marketing/subscriptions";

export async function POST(req: NextRequest) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;
  const limited = await rateLimitOrThrow(req, "marketing");
  if (limited) return limited;

  try {
    const input = await parseJsonBody(
      req,
      MarketingSubscriptionRequestSchema,
    );
    const subscription = await subscribeToMarketing(input);
    return respData({
      subscriptionId: subscription.uuid,
      topic: subscription.topic,
      status: subscription.status,
    });
  } catch (error) {
    return respError(error, {
      fallback: "SERVER_ERROR",
      logFields: { event: "marketing.subscription_failed" },
    });
  }
}
