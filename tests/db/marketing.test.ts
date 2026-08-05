/**
 * Database tier: marketing consent and delivery idempotency.
 *
 * Campaign launches and recipient jobs can race across processes. These tests
 * prove the unique indexes collapse those races in PostgreSQL itself.
 */
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

import { db } from "@/db";
import {
  marketingCampaignDispatches,
  marketingEmailDeliveries,
  marketingSubscriptions,
} from "@/db/schema";
import {
  createMarketingCampaignDispatch,
  ensureMarketingEmailDelivery,
  upsertMarketingSubscription,
} from "@/models/marketing";
import { describeDb, useCleanDatabase } from "./setup";

describeDb("marketing delivery uniqueness", () => {
  useCleanDatabase();

  it("keeps one consent record per normalized address and topic", async () => {
    const consentedAt = new Date();
    const first = await upsertMarketingSubscription({
      email: "Reader@Example.test",
      emailKey: "reader@example.test",
      topic: "product-updates",
      locale: "en",
      consentSource: "footer",
      consentVersion: "2026-08",
      consentedAt,
    });
    const second = await upsertMarketingSubscription({
      email: "reader@example.test",
      emailKey: "reader@example.test",
      topic: "product-updates",
      locale: "fr",
      consentSource: "preferences",
      consentVersion: "2026-09",
      consentedAt: new Date(consentedAt.getTime() + 1_000),
    });

    expect(second.id).toBe(first.id);
    expect(second.locale).toBe("fr");
    expect(await db().select().from(marketingSubscriptions)).toHaveLength(1);
  });

  it("creates one immutable dispatch for concurrent copies of a launch", async () => {
    const campaignKey = randomUUID();
    const input = {
      campaignKey,
      contentHash: "a".repeat(64),
      message: { subject: "Product news" },
      audienceTopic: "product-updates",
    };

    const [first, second] = await Promise.all([
      createMarketingCampaignDispatch(input),
      createMarketingCampaignDispatch(input),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await db().select().from(marketingCampaignDispatches)).toHaveLength(1);
  });

  it("creates one delivery row when recipient jobs race", async () => {
    const campaignKey = randomUUID();
    const subscriptionUuid = randomUUID();

    const [first, second] = await Promise.all([
      ensureMarketingEmailDelivery({ campaignKey, subscriptionUuid }),
      ensureMarketingEmailDelivery({ campaignKey, subscriptionUuid }),
    ]);

    expect(second.id).toBe(first.id);
    expect(await db().select().from(marketingEmailDeliveries)).toHaveLength(1);
  });
});
