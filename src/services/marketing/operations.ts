import {
  MARKETING_CAMPAIGN_RECIPIENT_LIMIT,
  MARKETING_PROVIDER_EVENT_RETENTION_DAYS,
} from "@/config/marketing";
import { AppError } from "@/lib/errors";
import {
  cancelMarketingCampaignWork,
  countActiveMarketingSubscriptions,
  deleteMarketingProviderEventsBefore,
  getMarketingCampaignOverview,
  marketingDeliveryStatuses,
} from "@/models/marketing";
import type {
  MarketingAudienceRequest,
  MarketingCampaignActionRequest,
} from "./contracts";

export async function pruneMarketingProviderEvents(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(
    now.getTime() -
      MARKETING_PROVIDER_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  );
  return deleteMarketingProviderEventsBefore(cutoff);
}

export async function previewMarketingAudience(
  input: MarketingAudienceRequest,
) {
  const recipients = await countActiveMarketingSubscriptions(input.audience);
  return {
    audience: input.audience,
    recipients,
    limit: MARKETING_CAMPAIGN_RECIPIENT_LIMIT,
    overLimit: recipients > MARKETING_CAMPAIGN_RECIPIENT_LIMIT,
  };
}

export async function getMarketingCampaignStatus(
  input: MarketingCampaignActionRequest,
) {
  const overview = await getMarketingCampaignOverview(input.campaignKey);
  if (!overview) {
    throw new AppError("RESOURCE_NOT_FOUND", {
      message: `marketing campaign ${input.campaignKey} was not found`,
    });
  }

  const { dispatch, counts } = overview;
  const status =
    dispatch.status === "queued" &&
    dispatch.scheduled_for &&
    dispatch.scheduled_for.getTime() > Date.now()
      ? "scheduled"
      : dispatch.status;
  const processed = marketingDeliveryStatuses
    .filter((status) => !["queued", "sent", "delayed"].includes(status))
    .reduce((total, status) => total + counts[status], 0);
  return {
    campaignKey: dispatch.campaign_key,
    status,
    recipients: dispatch.recipient_count,
    queued: dispatch.queued_count,
    processed,
    counts,
    scheduledFor: dispatch.scheduled_for?.toISOString() ?? null,
    requestedAt: dispatch.requested_at.toISOString(),
    completedAt: dispatch.completed_at?.toISOString() ?? null,
    canceledAt: dispatch.canceled_at?.toISOString() ?? null,
  };
}

export async function cancelMarketingCampaign(
  input: MarketingCampaignActionRequest,
) {
  const canceled = await cancelMarketingCampaignWork(input.campaignKey);
  if (!canceled.found) {
    throw new AppError("RESOURCE_NOT_FOUND", {
      message: `marketing campaign ${input.campaignKey} was not found`,
    });
  }
  if (canceled.alreadyCompleted) {
    throw new AppError("REQUEST_INVALID", {
      statusCode: 409,
      message: `marketing campaign ${input.campaignKey} is already completed`,
    });
  }
  return {
    ...canceled,
    campaign: await getMarketingCampaignStatus(input),
  };
}
