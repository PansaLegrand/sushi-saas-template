import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { stripeWebhookEvents } from "@/db/schema";

const PROCESSING_STALE_MS = 15 * 60 * 1000;

/**
 * Statuses a delivery may reclaim.
 *
 * `failed` is transient by assumption — the database was down, the network
 * blipped — so a redelivery should try again. `action_required` is *not*
 * transient, and it is reclaimable for a different reason: the automatic retries
 * have already been stopped with a 200, so the only delivery that reaches here
 * is one a human triggered from the Stripe dashboard after fixing the cause.
 * Refusing it would mean the fix could not be applied to the event that found
 * the problem.
 */
const RECLAIMABLE_STATUSES = ["failed", "action_required"] as const;

export type StripeWebhookClaimStatus = "claimed" | "completed" | "processing";

/**
 * The denormalized columns, as extracted by
 * `src/services/stripe/receipt.ts`. Typed structurally rather than imported so
 * this model keeps no dependency on the Stripe SDK — it takes values and puts
 * them in columns.
 */
export interface StripeWebhookEventReceipt {
  stripe_object_id?: string | null;
  stripe_customer_id?: string | null;
  stripe_invoice_id?: string | null;
  stripe_subscription_id?: string | null;
  livemode?: boolean | null;
  api_version?: string | null;
  request_id?: string | null;
}

interface ClaimStripeWebhookEventParams {
  eventId: string;
  eventType: string;
  payload?: string;
  receipt?: StripeWebhookEventReceipt;
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
  receipt,
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
      ...receipt,
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
  const reclaimable = (RECLAIMABLE_STATUSES as readonly string[]).includes(
    existing.status
  );
  const canRetry =
    reclaimable ||
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
      // Refreshed alongside the payload, not left at whatever the first attempt
      // wrote. A row claimed before 0019 has nulls here, and a retry is the only
      // chance it gets to fill them — leaving them stale would mean the receipt
      // and the payload it was derived from disagreed.
      ...receipt,
    })
    .where(
      and(
        eq(stripeWebhookEvents.event_id, eventId),
        // Guards against losing a race with another delivery between the read
        // above and this write: whatever made the row claimable must still hold.
        reclaimable
          ? eq(stripeWebhookEvents.status, existing.status)
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

/**
 * Park an event that needs a human, with the reason a human will read.
 *
 * Separate from `markStripeWebhookEventFailed` because the two mean opposite
 * things to whoever is looking: a failure is expected to clear on retry, and this
 * is expected not to. The reason lands in `last_error` — the column holds "why
 * this row is not completed", which covers a thrown error and a human-decision
 * case alike, and renaming it would be a migration for no gain.
 */
export async function markStripeWebhookEventActionRequired(
  eventId: string,
  reason: string
) {
  await db()
    .update(stripeWebhookEvents)
    .set({
      status: "action_required",
      last_error: reason.slice(0, 4000),
      updated_at: new Date(),
    })
    .where(eq(stripeWebhookEvents.event_id, eventId));
}

export type StripeWebhookEventRow = typeof stripeWebhookEvents.$inferSelect;

/**
 * Events that are not going to resolve on their own.
 *
 * `action_required` never will, by definition. `failed` is the harder half: it
 * looks transient, but Stripe stops redelivering after roughly three days, so a
 * `failed` row older than that is permanently stuck with nothing left to retry it
 * — and it looks identical to one that will succeed on the next delivery. Age is
 * the only thing that separates them, which is why this takes a cutoff.
 */
export async function findStuckStripeWebhookEvents({
  failedBefore,
  limit = 50,
}: {
  failedBefore: Date;
  limit?: number;
}): Promise<StripeWebhookEventRow[]> {
  return db()
    .select()
    .from(stripeWebhookEvents)
    .where(
      or(
        eq(stripeWebhookEvents.status, "action_required"),
        and(
          eq(stripeWebhookEvents.status, "failed"),
          lt(stripeWebhookEvents.updated_at, failedBefore)
        )
      )
    )
    .orderBy(asc(stripeWebhookEvents.updated_at))
    .limit(limit);
}

/**
 * Every event recorded for one Stripe invoice.
 *
 * The query migration 0019's `stripe_invoice_id` index exists for, and what
 * reconciliation uses to ask "did we ever receive this invoice's event". Against
 * `payload` alone this was a full scan and a JSON parse per row.
 */
export async function findStripeWebhookEventsByInvoiceId(
  invoiceId: string
): Promise<StripeWebhookEventRow[]> {
  return db()
    .select()
    .from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.stripe_invoice_id, invoiceId))
    .orderBy(asc(stripeWebhookEvents.received_at));
}

/**
 * A page of webhook events, newest first, optionally filtered by status.
 *
 * Deliberately in the model layer rather than in `apps/admin/lib/data.ts`. That
 * file holds a parallel query layer the architecture rules do not reach, and
 * this query is about to be the operator's main view onto billing — the last
 * thing it should be is unpoliced.
 *
 * `payload` is **not** selected. It holds the whole Stripe object, which for a
 * checkout session includes the customer's email and address. The denormalized
 * columns from migration 0019 answer the operational questions without shipping
 * personal data to a browser, and a payload nobody needs is a payload that
 * cannot leak.
 */
export async function listStripeWebhookEvents({
  status,
  page = 1,
  limit = 50,
}: {
  status?: string;
  page?: number;
  limit?: number;
}): Promise<Omit<StripeWebhookEventRow, "payload">[]> {
  const offset = (Math.max(page, 1) - 1) * limit;

  const query = db()
    .select({
      id: stripeWebhookEvents.id,
      event_id: stripeWebhookEvents.event_id,
      event_type: stripeWebhookEvents.event_type,
      status: stripeWebhookEvents.status,
      attempts: stripeWebhookEvents.attempts,
      last_error: stripeWebhookEvents.last_error,
      received_at: stripeWebhookEvents.received_at,
      processed_at: stripeWebhookEvents.processed_at,
      updated_at: stripeWebhookEvents.updated_at,
      stripe_object_id: stripeWebhookEvents.stripe_object_id,
      stripe_customer_id: stripeWebhookEvents.stripe_customer_id,
      stripe_invoice_id: stripeWebhookEvents.stripe_invoice_id,
      stripe_subscription_id: stripeWebhookEvents.stripe_subscription_id,
      livemode: stripeWebhookEvents.livemode,
      api_version: stripeWebhookEvents.api_version,
      request_id: stripeWebhookEvents.request_id,
    })
    .from(stripeWebhookEvents)
    .$dynamic();

  const rows = await (status
    ? query.where(eq(stripeWebhookEvents.status, status))
    : query
  )
    // `received_at` rather than `updated_at`: an operator scanning this is
    // asking "what arrived", and sorting by update time reshuffles the list
    // every time the sweep or a retry touches a row.
    .orderBy(desc(stripeWebhookEvents.received_at))
    .limit(limit)
    .offset(offset);

  return rows;
}

/** Row counts per status, for the cron sweep's summary and the health check. */
export async function countStripeWebhookEventsByStatus(): Promise<
  Record<string, number>
> {
  const rows = await db()
    .select({
      status: stripeWebhookEvents.status,
      count: sql<number>`count(*)::int`,
    })
    .from(stripeWebhookEvents)
    .groupBy(stripeWebhookEvents.status);

  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
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
