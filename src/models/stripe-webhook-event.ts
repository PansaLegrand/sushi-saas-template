import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { stripeWebhookEvents } from "@/db/schema";

const PROCESSING_STALE_MS = 15 * 60 * 1000;

export type StripeWebhookClaimStatus = "claimed" | "completed" | "processing";

interface ClaimStripeWebhookEventParams {
  eventId: string;
  eventType: string;
  payload?: string;
}

function serializeError(error: unknown) {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : JSON.stringify(error);

  return (message || "unknown error").slice(0, 4000);
}

export async function claimStripeWebhookEvent({
  eventId,
  eventType,
  payload,
}: ClaimStripeWebhookEventParams): Promise<StripeWebhookClaimStatus> {
  const now = new Date();

  const [inserted] = await db()
    .insert(stripeWebhookEvents)
    .values({
      event_id: eventId,
      event_type: eventType,
      status: "processing",
      attempts: 1,
      payload,
      received_at: now,
      updated_at: now,
    })
    .onConflictDoNothing({ target: stripeWebhookEvents.event_id })
    .returning({ id: stripeWebhookEvents.id });

  if (inserted) {
    return "claimed";
  }

  const [existing] = await db()
    .select()
    .from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.event_id, eventId))
    .limit(1);

  if (!existing) {
    throw new Error(`Failed to claim Stripe webhook event ${eventId}`);
  }

  if (existing.status === "completed") {
    return "completed";
  }

  const staleBefore = new Date(now.getTime() - PROCESSING_STALE_MS);
  const canRetry =
    existing.status === "failed" ||
    (existing.status === "processing" &&
      existing.updated_at &&
      existing.updated_at < staleBefore);

  if (!canRetry) {
    return "processing";
  }

  const [claimed] = await db()
    .update(stripeWebhookEvents)
    .set({
      status: "processing",
      attempts: sql`${stripeWebhookEvents.attempts} + 1`,
      event_type: eventType,
      payload,
      last_error: null,
      updated_at: now,
    })
    .where(
      and(
        eq(stripeWebhookEvents.event_id, eventId),
        existing.status === "failed"
          ? eq(stripeWebhookEvents.status, "failed")
          : lt(stripeWebhookEvents.updated_at, staleBefore)
      )
    )
    .returning({ id: stripeWebhookEvents.id });

  return claimed ? "claimed" : "processing";
}

export async function markStripeWebhookEventCompleted(eventId: string) {
  const now = new Date();

  await db()
    .update(stripeWebhookEvents)
    .set({
      status: "completed",
      processed_at: now,
      updated_at: now,
      last_error: null,
    })
    .where(eq(stripeWebhookEvents.event_id, eventId));
}

export async function markStripeWebhookEventFailed(
  eventId: string,
  error: unknown
) {
  await db()
    .update(stripeWebhookEvents)
    .set({
      status: "failed",
      last_error: serializeError(error),
      updated_at: new Date(),
    })
    .where(eq(stripeWebhookEvents.event_id, eventId));
}
