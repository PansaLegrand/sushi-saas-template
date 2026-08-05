import { AppError } from "@/lib/errors";
import {
  unsubscribeMarketingSubscription,
  upsertMarketingSubscription,
} from "@/models/marketing";
import type { MarketingSubscriptionRequest } from "./contracts";
import { verifyMarketingUnsubscribeToken } from "./unsubscribe-token";

function emailKey(email: string): string {
  // This is deliberately less aggressive than signup-abuse normalization.
  // Marketing consent belongs to the exact mailbox, so provider-specific dot
  // or plus alias rules must never merge two consent records.
  return email.trim().toLowerCase();
}

export async function subscribeToMarketing(
  input: MarketingSubscriptionRequest,
) {
  return upsertMarketingSubscription({
    email: input.email.trim(),
    emailKey: emailKey(input.email),
    topic: input.topic,
    locale: input.locale,
    consentSource: input.consentSource,
    consentVersion: input.consentVersion,
    consentedAt: new Date(),
  });
}

export async function unsubscribeFromMarketingToken(
  token: string,
): Promise<void> {
  const payload = verifyMarketingUnsubscribeToken(token);
  if (!payload) {
    throw new AppError("AUTH_INVALID_TOKEN", {
      message: "invalid marketing unsubscribe token",
    });
  }

  // Idempotent on purpose: repeated one-click requests and people refreshing a
  // success page must remain successful without leaking subscription state.
  await unsubscribeMarketingSubscription({
    uuid: payload.subscriptionUuid,
    topic: payload.topic,
    at: new Date(),
  });
}
