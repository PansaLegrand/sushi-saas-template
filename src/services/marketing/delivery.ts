import { getAppEnv, getRequiredEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  findMarketingCampaignDispatch,
  findMarketingSubscriptionByUuid,
  markMarketingDeliveryFailed,
  markMarketingDeliverySent,
  markMarketingDeliverySkipped,
} from "@/models/marketing";
import { sendMail } from "@/services/email/send";
import { MarketingMessageSchema, type MarketingMessage } from "./contracts";
import { renderMarketingMessage } from "./render";
import { createMarketingUnsubscribeToken } from "./unsubscribe-token";

type DeliveryContext = {
  idempotencyKey: string;
  signal: AbortSignal;
  finalAttempt?: boolean;
};

function parseMessage(value: unknown): MarketingMessage {
  const result = MarketingMessageSchema.safeParse(value);
  if (!result.success) {
    throw new AppError("SERVER_ERROR", {
      message: `stored marketing message failed validation: ${result.error.message}`,
    });
  }
  return result.data;
}

function marketingFrom(message: MarketingMessage): string | undefined {
  if (!message.fromName) return undefined;
  const configured = getRequiredEnv("EMAIL_FROM");
  const bracketed = configured.match(/<([^>]+)>/);
  const address = bracketed?.[1] ?? configured;
  return `${message.fromName} <${address}>`;
}

function providerMessageId(result: unknown): string | undefined {
  const id = (result as { data?: { id?: unknown } } | null)?.data?.id;
  return typeof id === "string" ? id : undefined;
}

export async function sendMarketingCampaignDelivery(
  input: {
    deliveryUuid: string;
    subscriptionUuid: string;
    campaignKey: string;
  },
  context: DeliveryContext,
): Promise<void> {
  const campaign = await findMarketingCampaignDispatch(input.campaignKey);
  if (!campaign) {
    throw new AppError("RESOURCE_NOT_FOUND", {
      message: `marketing campaign ${input.campaignKey} was not found`,
    });
  }
  if (campaign.status === "canceled") {
    await markMarketingDeliverySkipped(input.deliveryUuid);
    return;
  }
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(campaign.message_json);
  } catch (cause) {
    throw new AppError("SERVER_ERROR", {
      message: `marketing campaign ${input.campaignKey} has an invalid snapshot`,
      cause,
    });
  }
  const message = parseMessage(snapshot);
  const subscription = await findMarketingSubscriptionByUuid(
    input.subscriptionUuid,
  );

  // Consent is checked here, not only when the campaign was queued. This is
  // what makes a late unsubscribe win over already scheduled work.
  if (!subscription || subscription.status !== "subscribed") {
    await markMarketingDeliverySkipped(input.deliveryUuid);
    return;
  }

  const token = createMarketingUnsubscribeToken({
    subscriptionUuid: subscription.uuid,
    topic: subscription.topic,
  });
  const unsubscribeUrl = new URL("/api/marketing/unsubscribe", getAppEnv().NEXT_PUBLIC_WEB_URL);
  unsubscribeUrl.searchParams.set("token", token);
  const rendered = renderMarketingMessage(message, unsubscribeUrl.toString());
  const { finalAttempt, ...mailContext } = context;

  try {
    const result = await sendMail({
      to: subscription.email,
      from: marketingFrom(message),
      replyTo: message.replyTo,
      subject: message.subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl.toString()}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: [
        { name: "marketing_delivery", value: input.deliveryUuid },
        {
          name: "marketing_campaign",
          value: input.campaignKey
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .slice(0, 256),
        },
      ],
      ...mailContext,
    });
    await markMarketingDeliverySent({
      deliveryUuid: input.deliveryUuid,
      providerMessageId: providerMessageId(result),
    });
  } catch (cause) {
    await markMarketingDeliveryFailed(
      input.deliveryUuid,
      cause instanceof Error ? cause.message : String(cause),
      Boolean(finalAttempt),
    );
    throw new AppError("SERVICE_UNAVAILABLE", {
      message: "marketing email provider delivery failed",
      cause,
    });
  }
}

export async function sendMarketingTestDelivery(
  input: { recipient: string; message: MarketingMessage },
  context: Omit<DeliveryContext, "finalAttempt">,
): Promise<void> {
  const message = parseMessage(input.message);
  const placeholder = new URL(
    "/api/marketing/unsubscribe?test=1",
    getAppEnv().NEXT_PUBLIC_WEB_URL,
  ).toString();
  const rendered = renderMarketingMessage(message, placeholder);
  await sendMail({
    to: input.recipient,
    from: marketingFrom(message),
    replyTo: message.replyTo,
    subject: `[TEST] ${message.subject}`,
    html: rendered.html,
    text: rendered.text,
    ...context,
  });
}
