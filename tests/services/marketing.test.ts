import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  models: {
    createMarketingCampaignDispatch: vi.fn(),
    ensureMarketingEmailDelivery: vi.fn(),
    findMarketingCampaignDispatch: vi.fn(),
    finishMarketingCampaignDispatch: vi.fn(),
    listActiveMarketingSubscriptions: vi.fn(),
    findMarketingSubscriptionByUuid: vi.fn(),
    markMarketingDeliveryFailed: vi.fn(),
    markMarketingDeliverySent: vi.fn(),
    markMarketingDeliverySkipped: vi.fn(),
  },
  enqueueJob: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("@/models/marketing", () => mocks.models);
vi.mock("@/services/jobs", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/services/email/send", () => ({ sendMail: mocks.sendMail }));

import { dispatchMarketingCampaign } from "@/services/marketing/dispatch";
import { sendMarketingCampaignDelivery } from "@/services/marketing/delivery";

const message = {
  campaignKey: "release-2026-08",
  locale: "en" as const,
  subject: "Release notes",
  preheader: "A short summary",
  template: {
    accentColor: "#15856f",
    pageBackgroundColor: "#f4f3ee",
    contentBackgroundColor: "#ffffff",
    footerText: "Product news",
    companyAddress: "1 Example Street",
  },
  blocks: [
    { type: "text" as const, text: "Hello", align: "left" as const },
  ],
};

describe("marketing campaign delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const requestedAt = new Date("2026-08-03T00:00:00.000Z");
    mocks.models.createMarketingCampaignDispatch.mockImplementation(async (input) => ({
      campaign_key: input.campaignKey,
      content_hash: input.contentHash,
      message_json: JSON.stringify(input.message),
      requested_at: requestedAt,
    }));
    mocks.models.listActiveMarketingSubscriptions.mockResolvedValue([
      { uuid: "subscription-1" },
    ]);
    mocks.models.ensureMarketingEmailDelivery.mockResolvedValue({ uuid: "delivery-1" });
    mocks.enqueueJob.mockResolvedValue(true);
    mocks.models.finishMarketingCampaignDispatch.mockResolvedValue(undefined);
  });

  it("freezes the audience at launch and keeps large content out of recipient jobs", async () => {
    const result = await dispatchMarketingCampaign({
      requestId: "launch:release-2026-08",
      message,
      audience: { topic: "product-updates", locale: "en" },
    });

    expect(mocks.models.listActiveMarketingSubscriptions).toHaveBeenCalledWith({
      topic: "product-updates",
      locale: "en",
      limit: 5001,
      consentedBefore: new Date("2026-08-03T00:00:00.000Z"),
    });
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      "marketing_campaign_email",
      {
        deliveryUuid: "delivery-1",
        subscriptionUuid: "subscription-1",
        campaignKey: "release-2026-08",
      },
      expect.objectContaining({ retryFailed: true }),
    );
    expect(result).toMatchObject({ recipients: 1, newlyQueued: 1 });
  });

  it("checks current consent again inside the worker", async () => {
    mocks.models.findMarketingCampaignDispatch.mockResolvedValue({
      message_json: JSON.stringify(message),
    });
    mocks.models.findMarketingSubscriptionByUuid.mockResolvedValue({
      uuid: "subscription-1",
      status: "unsubscribed",
    });

    await sendMarketingCampaignDelivery(
      {
        deliveryUuid: "delivery-1",
        subscriptionUuid: "subscription-1",
        campaignKey: "release-2026-08",
      },
      {
        idempotencyKey: "job-1",
        signal: new AbortController().signal,
      },
    );

    expect(mocks.models.markMarketingDeliverySkipped).toHaveBeenCalledWith("delivery-1");
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});
