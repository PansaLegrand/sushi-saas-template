import { Resend, type WebhookEventPayload } from "resend";

import { getRequiredEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  applyMarketingProviderEvent,
  applyMarketingProviderSuppressionEvent,
  type MarketingProviderEventInput,
} from "@/models/marketing";

const supportedEventTypes = new Set<MarketingProviderEventInput["eventType"]>([
  "email.sent",
  "email.delivery_delayed",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
]);

function isSupportedEvent(
  event: WebhookEventPayload,
): event is Extract<
  WebhookEventPayload,
  { type: MarketingProviderEventInput["eventType"] }
> {
  return supportedEventTypes.has(
    event.type as MarketingProviderEventInput["eventType"],
  );
}

function eventDetail(
  event: Extract<
    WebhookEventPayload,
    { type: MarketingProviderEventInput["eventType"] }
  >,
): string | undefined {
  switch (event.type) {
    case "email.bounced":
      return event.data.bounce.message;
    case "email.failed":
      return event.data.failed.reason;
    case "email.suppressed":
      return event.data.suppressed.message;
    case "email.complained":
      return "recipient marked the message as spam";
    default:
      return undefined;
  }
}

export async function handleResendMarketingWebhook(input: {
  payload: string;
  headers: Headers;
}): Promise<{
  handled: boolean;
  outcome?: "applied" | "duplicate" | "unmatched" | "older_event";
}> {
  const eventId = input.headers.get("svix-id");
  const timestamp = input.headers.get("svix-timestamp");
  const signature = input.headers.get("svix-signature");
  if (!eventId || !timestamp || !signature) {
    throw new AppError("AUTH_FORBIDDEN", {
      message: "missing Resend webhook signature headers",
    });
  }

  let event: WebhookEventPayload;
  try {
    event = new Resend(getRequiredEnv("RESEND_API_KEY")).webhooks.verify({
      payload: input.payload,
      headers: { id: eventId, timestamp, signature },
      webhookSecret: getRequiredEnv("RESEND_WEBHOOK_SECRET"),
    });
  } catch (cause) {
    throw new AppError("AUTH_FORBIDDEN", {
      message: "Resend webhook signature verification failed",
      cause,
    });
  }

  // Global suppression events synchronize mailbox state. Other email events
  // belong in the campaign ledger only when our outbound delivery tag exists.
  if (
    event.type === "suppression.added" ||
    event.type === "suppression.removed"
  ) {
    const occurredAt = new Date(event.created_at);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new AppError("REQUEST_INVALID", {
        message: "Resend webhook contained an invalid event timestamp",
      });
    }
    return {
      handled: true,
      outcome: await applyMarketingProviderSuppressionEvent({
        eventId,
        eventType: event.type,
        emailKey: event.data.email.trim().toLowerCase(),
        sourceId: event.data.source_id ?? undefined,
        reason: `provider_${event.data.origin}`,
        occurredAt,
      }),
    };
  }
  if (!isSupportedEvent(event)) return { handled: false };
  const deliveryUuid = event.data.tags?.marketing_delivery;
  if (!deliveryUuid) return { handled: false };

  const occurredAt = new Date(event.created_at);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new AppError("REQUEST_INVALID", {
      message: "Resend webhook contained an invalid event timestamp",
    });
  }

  const outcome = await applyMarketingProviderEvent({
    eventId,
    eventType: event.type,
    providerMessageId: event.data.email_id,
    deliveryUuid: deliveryUuid.slice(0, 255),
    occurredAt,
    detail: eventDetail(event),
  });
  return { handled: true, outcome };
}
