import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  jobs,
  marketingCampaignDispatches,
  marketingEmailDeliveries,
  marketingProviderEvents,
  marketingSubscriptions,
} from "@/db/schema";

export type MarketingSubscriptionRow =
  typeof marketingSubscriptions.$inferSelect;
export type MarketingCampaignDispatchRow =
  typeof marketingCampaignDispatches.$inferSelect;
export type MarketingEmailDeliveryRow =
  typeof marketingEmailDeliveries.$inferSelect;

export const marketingDeliveryStatuses = [
  "queued",
  "sent",
  "delayed",
  "delivered",
  "bounced",
  "complained",
  "suppressed",
  "skipped",
  "failed",
] as const;
export type MarketingDeliveryStatus =
  (typeof marketingDeliveryStatuses)[number];

const terminalDeliveryStatuses: MarketingDeliveryStatus[] = [
  "delivered",
  "bounced",
  "complained",
  "suppressed",
  "skipped",
  "failed",
];

const deliveryStatusPriority: Record<MarketingDeliveryStatus, number> = {
  queued: 0,
  sent: 1,
  delayed: 2,
  delivered: 3,
  failed: 3,
  skipped: 4,
  bounced: 5,
  suppressed: 6,
  complained: 7,
};

function statusPriority(status: string): number {
  return marketingDeliveryStatuses.includes(status as MarketingDeliveryStatus)
    ? deliveryStatusPriority[status as MarketingDeliveryStatus]
    : -1;
}

export type MarketingProviderEventInput = {
  eventId: string;
  eventType:
    | "email.sent"
    | "email.delivery_delayed"
    | "email.delivered"
    | "email.bounced"
    | "email.complained"
    | "email.failed"
    | "email.suppressed";
  providerMessageId: string;
  deliveryUuid?: string;
  occurredAt: Date;
  detail?: string;
};

export type MarketingProviderSuppressionEventInput = {
  eventId: string;
  eventType: "suppression.added" | "suppression.removed";
  emailKey: string;
  sourceId?: string;
  reason: string;
  occurredAt: Date;
};

const providerStatus: Record<
  MarketingProviderEventInput["eventType"],
  MarketingDeliveryStatus
> = {
  "email.sent": "sent",
  "email.delivery_delayed": "delayed",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "suppressed",
};

export async function upsertMarketingSubscription(input: {
  email: string;
  emailKey: string;
  topic: string;
  locale: string;
  consentSource: string;
  consentVersion: string;
  consentedAt: Date;
}): Promise<MarketingSubscriptionRow> {
  const now = new Date();
  const [row] = await db()
    .insert(marketingSubscriptions)
    .values({
      uuid: randomUUID(),
      email: input.email,
      email_key: input.emailKey,
      topic: input.topic,
      locale: input.locale,
      status: "subscribed",
      consent_source: input.consentSource,
      consent_version: input.consentVersion,
      consented_at: input.consentedAt,
      unsubscribed_at: null,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: [marketingSubscriptions.email_key, marketingSubscriptions.topic],
      set: {
        email: input.email,
        locale: input.locale,
        // A hard provider suppression wins over a later form submission. It
        // must be cleared deliberately after the mailbox problem is resolved.
        status: sql`case when ${marketingSubscriptions.suppressed_at} is not null then 'suppressed' else 'subscribed' end`,
        consent_source: input.consentSource,
        consent_version: input.consentVersion,
        consented_at: input.consentedAt,
        unsubscribed_at: null,
        updated_at: now,
      },
    })
    .returning();

  return row;
}

export async function findMarketingSubscriptionByUuid(
  uuid: string,
): Promise<MarketingSubscriptionRow | undefined> {
  const [row] = await db()
    .select()
    .from(marketingSubscriptions)
    .where(eq(marketingSubscriptions.uuid, uuid))
    .limit(1);
  return row;
}

export async function listActiveMarketingSubscriptions(input: {
  topic: string;
  locale?: string;
  limit: number;
  consentedBefore: Date;
}): Promise<MarketingSubscriptionRow[]> {
  const predicates = [
    eq(marketingSubscriptions.status, "subscribed"),
    eq(marketingSubscriptions.topic, input.topic),
    lte(marketingSubscriptions.consented_at, input.consentedBefore),
  ];
  if (input.locale) {
    predicates.push(eq(marketingSubscriptions.locale, input.locale));
  }

  return db()
    .select()
    .from(marketingSubscriptions)
    .where(and(...predicates))
    .orderBy(marketingSubscriptions.id)
    .limit(input.limit);
}

export async function countActiveMarketingSubscriptions(input: {
  topic: string;
  locale?: string;
  consentedBefore?: Date;
}): Promise<number> {
  const predicates = [
    eq(marketingSubscriptions.status, "subscribed"),
    eq(marketingSubscriptions.topic, input.topic),
  ];
  if (input.locale) {
    predicates.push(eq(marketingSubscriptions.locale, input.locale));
  }
  if (input.consentedBefore) {
    predicates.push(
      lte(marketingSubscriptions.consented_at, input.consentedBefore),
    );
  }

  const [row] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(marketingSubscriptions)
    .where(and(...predicates));
  return row?.count ?? 0;
}

export async function unsubscribeMarketingSubscription(input: {
  uuid: string;
  topic: string;
  at: Date;
}): Promise<boolean> {
  const [row] = await db()
    .update(marketingSubscriptions)
    .set({
      status: "unsubscribed",
      unsubscribed_at: input.at,
      updated_at: input.at,
    })
    .where(
      and(
        eq(marketingSubscriptions.uuid, input.uuid),
        eq(marketingSubscriptions.topic, input.topic),
      ),
    )
    .returning({ id: marketingSubscriptions.id });
  return Boolean(row);
}

export async function createMarketingCampaignDispatch(input: {
  campaignKey: string;
  contentHash: string;
  message: unknown;
  audienceTopic: string;
  audienceLocale?: string;
  scheduledFor?: Date;
}): Promise<MarketingCampaignDispatchRow | undefined> {
  const [row] = await db()
    .insert(marketingCampaignDispatches)
    .values({
      uuid: randomUUID(),
      campaign_key: input.campaignKey,
      content_hash: input.contentHash,
      message_json: JSON.stringify(input.message),
      audience_topic: input.audienceTopic,
      audience_locale: input.audienceLocale ?? null,
      scheduled_for: input.scheduledFor ?? null,
    })
    .onConflictDoNothing({ target: marketingCampaignDispatches.campaign_key })
    .returning();
  return row;
}

export async function findMarketingCampaignDispatch(
  campaignKey: string,
): Promise<MarketingCampaignDispatchRow | undefined> {
  const [row] = await db()
    .select()
    .from(marketingCampaignDispatches)
    .where(eq(marketingCampaignDispatches.campaign_key, campaignKey))
    .limit(1);
  return row;
}

export async function finishMarketingCampaignDispatch(input: {
  campaignKey: string;
  recipientCount: number;
  queuedCount: number;
  status: "queued" | "completed" | "failed";
}): Promise<void> {
  const now = new Date();
  await db()
    .update(marketingCampaignDispatches)
    .set({
      status: input.status,
      recipient_count: input.recipientCount,
      queued_count: input.queuedCount,
      completed_at: input.status === "queued" ? null : now,
      updated_at: now,
    })
    .where(eq(marketingCampaignDispatches.campaign_key, input.campaignKey));
}

export async function ensureMarketingEmailDelivery(input: {
  campaignKey: string;
  subscriptionUuid: string;
}): Promise<MarketingEmailDeliveryRow> {
  const [created] = await db()
    .insert(marketingEmailDeliveries)
    .values({
      uuid: randomUUID(),
      campaign_key: input.campaignKey,
      subscription_uuid: input.subscriptionUuid,
    })
    .onConflictDoNothing({
      target: [
        marketingEmailDeliveries.campaign_key,
        marketingEmailDeliveries.subscription_uuid,
      ],
    })
    .returning();
  if (created) return created;

  const [existing] = await db()
    .select()
    .from(marketingEmailDeliveries)
    .where(
      and(
        eq(marketingEmailDeliveries.campaign_key, input.campaignKey),
        eq(marketingEmailDeliveries.subscription_uuid, input.subscriptionUuid),
      ),
    )
    .limit(1);
  return existing!;
}

async function refreshDispatchCompletion(
  tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0],
  campaignKey: string,
): Promise<void> {
  const [dispatch] = await tx
    .select({
      recipientCount: marketingCampaignDispatches.recipient_count,
      status: marketingCampaignDispatches.status,
    })
    .from(marketingCampaignDispatches)
    .where(eq(marketingCampaignDispatches.campaign_key, campaignKey))
    .limit(1);
  if (!dispatch || dispatch.status === "canceled") return;

  const [terminal] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(marketingEmailDeliveries)
    .where(
      and(
        eq(marketingEmailDeliveries.campaign_key, campaignKey),
        inArray(marketingEmailDeliveries.status, terminalDeliveryStatuses),
      ),
    );
  if ((terminal?.count ?? 0) < dispatch.recipientCount) return;

  const now = new Date();
  await tx
    .update(marketingCampaignDispatches)
    .set({ status: "completed", completed_at: now, updated_at: now })
    .where(eq(marketingCampaignDispatches.campaign_key, campaignKey));
}

export async function markMarketingDeliverySent(input: {
  deliveryUuid: string;
  providerMessageId?: string;
}): Promise<void> {
  const now = new Date();
  await db()
    .update(marketingEmailDeliveries)
    .set({
      status: sql`case when ${marketingEmailDeliveries.provider_event_at} is null then 'sent' else ${marketingEmailDeliveries.status} end`,
      provider_message_id: input.providerMessageId ?? null,
      sent_at: now,
      last_error: null,
      updated_at: now,
    })
    .where(eq(marketingEmailDeliveries.uuid, input.deliveryUuid));
}

export async function markMarketingDeliverySkipped(
  deliveryUuid: string,
): Promise<void> {
  const now = new Date();
  await db().transaction(async (tx) => {
    const [delivery] = await tx
      .update(marketingEmailDeliveries)
      .set({ status: "skipped", skipped_at: now, updated_at: now })
      .where(eq(marketingEmailDeliveries.uuid, deliveryUuid))
      .returning({ campaignKey: marketingEmailDeliveries.campaign_key });
    if (delivery) {
      await refreshDispatchCompletion(tx, delivery.campaignKey);
    }
  });
}

export async function markMarketingDeliveryFailed(
  deliveryUuid: string,
  error: string,
  terminal: boolean,
): Promise<void> {
  const now = new Date();
  await db().transaction(async (tx) => {
    const [delivery] = await tx
      .update(marketingEmailDeliveries)
      .set({
        // A retryable provider error is diagnostic state, not a terminal
        // delivery outcome. Keep it queued until the durable job is exhausted.
        status: terminal ? "failed" : "queued",
        last_error: error.slice(0, 4_000),
        updated_at: now,
      })
      .where(eq(marketingEmailDeliveries.uuid, deliveryUuid))
      .returning({ campaignKey: marketingEmailDeliveries.campaign_key });
    if (terminal && delivery) {
      await refreshDispatchCompletion(tx, delivery.campaignKey);
    }
  });
}

export async function applyMarketingProviderEvent(
  input: MarketingProviderEventInput,
): Promise<"applied" | "duplicate" | "unmatched" | "older_event"> {
  return db().transaction(async (tx) => {
    const [receipt] = await tx
      .insert(marketingProviderEvents)
      .values({
        event_id: input.eventId,
        event_type: input.eventType,
        provider_message_id: input.providerMessageId,
        delivery_uuid: input.deliveryUuid ?? null,
        outcome: "processing",
        occurred_at: input.occurredAt,
      })
      .onConflictDoNothing({ target: marketingProviderEvents.event_id })
      .returning({ id: marketingProviderEvents.id });
    if (!receipt) return "duplicate";

    const lookup = input.deliveryUuid
      ? eq(marketingEmailDeliveries.uuid, input.deliveryUuid)
      : eq(
          marketingEmailDeliveries.provider_message_id,
          input.providerMessageId,
        );
    const [delivery] = await tx
      .select()
      .from(marketingEmailDeliveries)
      .where(lookup)
      .limit(1);

    if (!delivery) {
      await tx
        .update(marketingProviderEvents)
        .set({ outcome: "unmatched" })
        .where(eq(marketingProviderEvents.id, receipt.id));
      return "unmatched";
    }

    const status = providerStatus[input.eventType];
    const eventTime = input.occurredAt.getTime();
    const previousTime = delivery.provider_event_at?.getTime();
    const isNewer =
      previousTime === undefined ||
      eventTime > previousTime ||
      (eventTime === previousTime &&
        deliveryStatusPriority[status] >= statusPriority(delivery.status));

    if (!isNewer) {
      await tx
        .update(marketingProviderEvents)
        .set({ delivery_uuid: delivery.uuid, outcome: "older_event" })
        .where(eq(marketingProviderEvents.id, receipt.id));
      return "older_event";
    }

    const eventFields = {
      ...(status === "delivered" ? { delivered_at: input.occurredAt } : {}),
      ...(status === "bounced" ? { bounced_at: input.occurredAt } : {}),
      ...(status === "complained" ? { complained_at: input.occurredAt } : {}),
      ...(status === "suppressed" ? { suppressed_at: input.occurredAt } : {}),
    };
    await tx
      .update(marketingEmailDeliveries)
      .set({
        status,
        provider_message_id: input.providerMessageId,
        provider_event_at: input.occurredAt,
        last_error:
          status === "bounced" || status === "failed" || status === "suppressed"
            ? (input.detail ?? status).slice(0, 4_000)
            : null,
        updated_at: new Date(),
        ...eventFields,
      })
      .where(eq(marketingEmailDeliveries.id, delivery.id));

    if (["bounced", "complained", "suppressed"].includes(status)) {
      const [subscription] = await tx
        .select({ emailKey: marketingSubscriptions.email_key })
        .from(marketingSubscriptions)
        .where(eq(marketingSubscriptions.uuid, delivery.subscription_uuid))
        .limit(1);
      if (subscription) {
        // Provider suppression is mailbox-wide. Applying it to every consent
        // topic prevents a complaint in one campaign from leaking into another
        // topic's next send.
        await tx
          .update(marketingSubscriptions)
          .set({
            status: sql`case when ${marketingSubscriptions.status} = 'unsubscribed' then 'unsubscribed' else 'suppressed' end`,
            suppressed_at: input.occurredAt,
            suppression_reason: status,
            suppression_event_at: input.occurredAt,
            updated_at: new Date(),
          })
          .where(
            and(
              eq(marketingSubscriptions.email_key, subscription.emailKey),
              or(
                isNull(marketingSubscriptions.suppression_event_at),
                lt(
                  marketingSubscriptions.suppression_event_at,
                  input.occurredAt,
                ),
              ),
            ),
          );
      }
    }

    await tx
      .update(marketingProviderEvents)
      .set({ delivery_uuid: delivery.uuid, outcome: "applied" })
      .where(eq(marketingProviderEvents.id, receipt.id));
    await refreshDispatchCompletion(tx, delivery.campaign_key);
    return "applied";
  });
}

export async function applyMarketingProviderSuppressionEvent(
  input: MarketingProviderSuppressionEventInput,
): Promise<"applied" | "duplicate" | "unmatched" | "older_event"> {
  return db().transaction(async (tx) => {
    const [receipt] = await tx
      .insert(marketingProviderEvents)
      .values({
        event_id: input.eventId,
        event_type: input.eventType,
        provider_message_id: input.sourceId ?? null,
        outcome: "processing",
        occurred_at: input.occurredAt,
      })
      .onConflictDoNothing({ target: marketingProviderEvents.event_id })
      .returning({ id: marketingProviderEvents.id });
    if (!receipt) return "duplicate";

    const [subscription] = await tx
      .select({ id: marketingSubscriptions.id })
      .from(marketingSubscriptions)
      .where(eq(marketingSubscriptions.email_key, input.emailKey))
      .limit(1);
    if (!subscription) {
      await tx
        .update(marketingProviderEvents)
        .set({ outcome: "unmatched" })
        .where(eq(marketingProviderEvents.id, receipt.id));
      return "unmatched";
    }

    const now = new Date();
    const eventIsNewer =
      input.eventType === "suppression.removed"
        ? or(
            isNull(marketingSubscriptions.suppression_event_at),
            lte(marketingSubscriptions.suppression_event_at, input.occurredAt),
          )
        : or(
            isNull(marketingSubscriptions.suppression_event_at),
            lt(marketingSubscriptions.suppression_event_at, input.occurredAt),
          );
    const rows = await tx
      .update(marketingSubscriptions)
      .set(
        input.eventType === "suppression.added"
          ? {
              status: sql`case when ${marketingSubscriptions.status} = 'unsubscribed' then 'unsubscribed' else 'suppressed' end`,
              suppressed_at: input.occurredAt,
              suppression_reason: input.reason.slice(0, 64),
              suppression_event_at: input.occurredAt,
              updated_at: now,
            }
          : {
              status: sql`case when ${marketingSubscriptions.status} = 'suppressed' then 'subscribed' else ${marketingSubscriptions.status} end`,
              suppressed_at: null,
              suppression_reason: null,
              suppression_event_at: input.occurredAt,
              updated_at: now,
            },
      )
      .where(
        and(eq(marketingSubscriptions.email_key, input.emailKey), eventIsNewer),
      )
      .returning({ id: marketingSubscriptions.id });
    const outcome = rows.length > 0 ? "applied" : "older_event";
    await tx
      .update(marketingProviderEvents)
      .set({ outcome })
      .where(eq(marketingProviderEvents.id, receipt.id));
    return outcome;
  });
}

export async function deleteMarketingProviderEventsBefore(
  cutoff: Date,
): Promise<number> {
  const cutoffIso = cutoff.toISOString();
  const result = await db().execute(sql`
    with deleted as (
      delete from ${marketingProviderEvents}
      where ${marketingProviderEvents.received_at} < ${cutoffIso}::timestamptz
      returning 1
    )
    select count(*)::int as count from deleted
  `);
  const rows = result as unknown as
    | Array<{ count: number | string }>
    | {
        rows?: Array<{ count: number | string }>;
      };
  const row = Array.isArray(rows) ? rows[0] : rows.rows?.[0];
  return Number(row?.count ?? 0);
}

export async function getMarketingCampaignOverview(campaignKey: string) {
  const dispatch = await findMarketingCampaignDispatch(campaignKey);
  if (!dispatch) return undefined;

  const rows = await db()
    .select({
      status: marketingEmailDeliveries.status,
      count: sql<number>`count(*)::int`,
    })
    .from(marketingEmailDeliveries)
    .where(eq(marketingEmailDeliveries.campaign_key, campaignKey))
    .groupBy(marketingEmailDeliveries.status);
  const counts = Object.fromEntries(
    marketingDeliveryStatuses.map((status) => [status, 0]),
  ) as Record<MarketingDeliveryStatus, number>;
  for (const row of rows) {
    if (row.status in counts) {
      counts[row.status as MarketingDeliveryStatus] = row.count;
    }
  }

  return { dispatch, counts };
}

export async function cancelMarketingCampaignWork(
  campaignKey: string,
): Promise<{
  found: boolean;
  alreadyCanceled: boolean;
  alreadyCompleted: boolean;
  canceledJobs: number;
  canceledDeliveries: number;
}> {
  return db().transaction(async (tx) => {
    const [dispatch] = await tx
      .select({ status: marketingCampaignDispatches.status })
      .from(marketingCampaignDispatches)
      .where(eq(marketingCampaignDispatches.campaign_key, campaignKey))
      .limit(1);
    if (!dispatch) {
      return {
        found: false,
        alreadyCanceled: false,
        alreadyCompleted: false,
        canceledJobs: 0,
        canceledDeliveries: 0,
      };
    }
    if (dispatch.status === "canceled") {
      return {
        found: true,
        alreadyCanceled: true,
        alreadyCompleted: false,
        canceledJobs: 0,
        canceledDeliveries: 0,
      };
    }
    if (dispatch.status === "completed") {
      return {
        found: true,
        alreadyCanceled: false,
        alreadyCompleted: true,
        canceledJobs: 0,
        canceledDeliveries: 0,
      };
    }

    const now = new Date();
    await tx
      .update(marketingCampaignDispatches)
      .set({
        status: "canceled",
        canceled_at: now,
        completed_at: now,
        updated_at: now,
      })
      .where(eq(marketingCampaignDispatches.campaign_key, campaignKey));
    const canceledJobs = await tx
      .update(jobs)
      .set({
        status: "canceled",
        last_error: "campaign canceled by publisher",
        completed_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(jobs.type, "marketing_campaign_email"),
          eq(jobs.status, "pending"),
          sql`${jobs.payload_json}::jsonb ->> 'campaignKey' = ${campaignKey}`,
        ),
      )
      .returning({ id: jobs.id });
    const canceledDeliveries = await tx
      .update(marketingEmailDeliveries)
      .set({
        status: "skipped",
        skipped_at: now,
        last_error: "campaign canceled before delivery",
        updated_at: now,
      })
      .where(
        and(
          eq(marketingEmailDeliveries.campaign_key, campaignKey),
          inArray(marketingEmailDeliveries.status, ["queued", "failed"]),
        ),
      )
      .returning({ id: marketingEmailDeliveries.id });

    return {
      found: true,
      alreadyCanceled: false,
      alreadyCompleted: false,
      canceledJobs: canceledJobs.length,
      canceledDeliveries: canceledDeliveries.length,
    };
  });
}
