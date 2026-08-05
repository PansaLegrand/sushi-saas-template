import { createHash } from "node:crypto";

import { MARKETING_CAMPAIGN_RECIPIENT_LIMIT } from "@/config/marketing";
import { AppError } from "@/lib/errors";
import {
  createMarketingCampaignDispatch,
  ensureMarketingEmailDelivery,
  findMarketingCampaignDispatch,
  finishMarketingCampaignDispatch,
  listActiveMarketingSubscriptions,
} from "@/models/marketing";
import { enqueueJob } from "@/services/jobs";
import type {
  MarketingDispatchRequest,
  MarketingTestRequest,
} from "./contracts";

function campaignHash(input: MarketingDispatchRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        message: input.message,
        audience: input.audience,
        scheduleAt: input.scheduleAt ?? null,
      }),
    )
    .digest("hex");
}

export async function queueMarketingTest(
  input: MarketingTestRequest,
): Promise<{ queued: boolean }> {
  const queued = await enqueueJob(
    "marketing_test_email",
    { recipient: input.recipient, message: input.message },
    {
      dedupeKey: `marketing-test:${input.requestId}`,
      retryFailed: true,
    },
  );
  return { queued };
}

export async function dispatchMarketingCampaign(
  input: MarketingDispatchRequest,
): Promise<{
  campaignKey: string;
  recipients: number;
  newlyQueued: number;
  scheduledFor: string;
  status: "queued" | "completed";
}> {
  const scheduledFor = input.scheduleAt
    ? new Date(input.scheduleAt)
    : new Date();
  if (scheduledFor.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1_000) {
    throw new AppError("REQUEST_VALIDATION_FAILED", {
      message: "marketing campaign cannot be scheduled more than one year ahead",
    });
  }

  const contentHash = campaignHash(input);
  const created = await createMarketingCampaignDispatch({
    campaignKey: input.message.campaignKey,
    contentHash,
    message: input.message,
    audienceTopic: input.audience.topic,
    audienceLocale: input.audience.locale,
    scheduledFor,
  });
  const dispatch =
    created ??
    (await findMarketingCampaignDispatch(input.message.campaignKey));
  if (!dispatch || dispatch.content_hash !== contentHash) {
    throw new AppError("REQUEST_INVALID", {
      statusCode: 409,
      message: `campaign key ${input.message.campaignKey} was already used with different content, audience, or schedule`,
    });
  }
  if (!created && dispatch.status === "canceled") {
    throw new AppError("REQUEST_INVALID", {
      statusCode: 409,
      message: `campaign key ${input.message.campaignKey} was canceled and cannot be reused`,
    });
  }
  if (!created && dispatch.status === "completed") {
    return {
      campaignKey: dispatch.campaign_key,
      recipients: dispatch.recipient_count,
      newlyQueued: 0,
      scheduledFor: (
        dispatch.scheduled_for ?? dispatch.requested_at
      ).toISOString(),
      status: "completed",
    };
  }

  const subscriptions = await listActiveMarketingSubscriptions({
    topic: input.audience.topic,
    locale: input.audience.locale,
    limit: MARKETING_CAMPAIGN_RECIPIENT_LIMIT + 1,
    consentedBefore: dispatch.requested_at,
  });
  if (subscriptions.length > MARKETING_CAMPAIGN_RECIPIENT_LIMIT) {
    await finishMarketingCampaignDispatch({
      campaignKey: input.message.campaignKey,
      recipientCount: subscriptions.length,
      queuedCount: 0,
      status: "failed",
    });
    throw new AppError("REQUEST_INVALID", {
      statusCode: 409,
      message: `campaign audience exceeds the ${MARKETING_CAMPAIGN_RECIPIENT_LIMIT} recipient safety limit`,
    });
  }

  let newlyQueued = 0;
  try {
    for (const subscription of subscriptions) {
      const delivery = await ensureMarketingEmailDelivery({
        campaignKey: input.message.campaignKey,
        subscriptionUuid: subscription.uuid,
      });
      const queued = await enqueueJob(
        "marketing_campaign_email",
        {
          deliveryUuid: delivery.uuid,
          subscriptionUuid: subscription.uuid,
          campaignKey: input.message.campaignKey,
        },
        {
          runAt: scheduledFor,
          dedupeKey: `marketing:${input.message.campaignKey}:${subscription.uuid}`,
          retryFailed: true,
        },
      );
      if (queued) newlyQueued += 1;
    }

    await finishMarketingCampaignDispatch({
      campaignKey: input.message.campaignKey,
      recipientCount: subscriptions.length,
      queuedCount: subscriptions.length,
      status: subscriptions.length === 0 ? "completed" : "queued",
    });
  } catch (cause) {
    await finishMarketingCampaignDispatch({
      campaignKey: input.message.campaignKey,
      recipientCount: subscriptions.length,
      queuedCount: newlyQueued,
      status: "failed",
    });
    if (cause instanceof AppError) throw cause;
    throw new AppError("SERVICE_UNAVAILABLE", {
      message: "marketing campaign could not be queued",
      cause,
    });
  }

  return {
    campaignKey: input.message.campaignKey,
    recipients: subscriptions.length,
    newlyQueued,
    scheduledFor: scheduledFor.toISOString(),
    status: subscriptions.length === 0 ? "completed" : "queued",
  };
}
