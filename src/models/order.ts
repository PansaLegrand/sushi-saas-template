import { orders } from "@/db/schema";
import { db } from "@/db";
import { and, asc, desc, eq, gte, or } from "drizzle-orm";

import { scopedToOrg } from "./organization";

export enum OrderStatus {
  Created = "created",
  Paid = "paid",
  Deleted = "deleted",
}

export type OrderRow = typeof orders.$inferSelect;

/** `org_uuid` is required: an order that belongs to no tenant can never be read back. */
export type OrderInsert = typeof orders.$inferInsert & { org_uuid: string };

export async function insertOrder(data: OrderInsert) {
  if (data.created_at && typeof data.created_at === "string") {
    data.created_at = new Date(data.created_at);
  }
  if (data.expired_at && typeof data.expired_at === "string") {
    data.expired_at = new Date(data.expired_at);
  }
  if (data.paid_at && typeof data.paid_at === "string") {
    data.paid_at = new Date(data.paid_at);
  }

  const [order] = await db().insert(orders).values(data).returning();

  return order;
}

/**
 * Claim one order for one organization-scoped browser purchase intent.
 *
 * `onConflictDoNothing` is the concurrency guarantee. Two server instances can
 * both receive the same double-click before either has created a Stripe
 * session; only one receives a row here, and the other resolves that row with
 * `findOrderByCheckoutIntent`.
 */
export async function insertOrderForCheckoutIntent(
  data: OrderInsert & { checkout_intent_id: string },
): Promise<OrderRow | undefined> {
  const [order] = await db()
    .insert(orders)
    .values(data)
    .onConflictDoNothing({
      target: [orders.org_uuid, orders.checkout_intent_id],
    })
    .returning();

  return order;
}

export async function findOrderByCheckoutIntent(
  orgUuid: string,
  checkoutIntentId: string,
): Promise<OrderRow | undefined> {
  const [order] = await db()
    .select()
    .from(orders)
    .where(
      and(
        scopedToOrg(orders.org_uuid, orgUuid),
        eq(orders.checkout_intent_id, checkoutIntentId),
      ),
    )
    .limit(1);

  return order;
}

/**
 * Lookup by `order_no`, which is globally unique.
 *
 * Unscoped by necessity: Stripe callbacks and webhooks arrive holding only this
 * identifier. Callers that then act on behalf of a signed-in user must compare
 * the row's `org_uuid` against their own context.
 */
export async function findOrderByOrderNo(
  order_no: string,
): Promise<typeof orders.$inferSelect | undefined> {
  const [order] = await db()
    .select()
    .from(orders)
    .where(eq(orders.order_no, order_no))
    .limit(1);

  return order;
}

export async function getFirstPaidOrderByOrg(
  orgUuid: string,
): Promise<typeof orders.$inferSelect | undefined> {
  const [order] = await db()
    .select()
    .from(orders)
    .where(
      and(
        scopedToOrg(orders.org_uuid, orgUuid),
        eq(orders.status, OrderStatus.Paid),
      ),
    )
    .orderBy(asc(orders.created_at))
    .limit(1);

  return order;
}

export async function getFirstPaidOrderByUserEmail(
  user_email: string,
): Promise<typeof orders.$inferSelect | undefined> {
  const [order] = await db()
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.user_email, user_email),
        eq(orders.status, OrderStatus.Paid),
      ),
    )
    .orderBy(desc(orders.created_at))
    .limit(1);

  return order;
}

export async function updateOrderStatus(
  order_no: string,
  status: string,
  paid_at: string,
  paid_email: string,
  paid_detail: string,
) {
  const [order] = await db()
    .update(orders)
    .set({ status, paid_at: new Date(paid_at), paid_detail, paid_email })
    .where(eq(orders.order_no, order_no))
    .returning();

  return order;
}

export async function updateOrderSession(
  order_no: string,
  stripe_session_id: string,
  order_detail: string,
) {
  const [order] = await db()
    .update(orders)
    .set({ stripe_session_id, order_detail })
    .where(eq(orders.order_no, order_no))
    .returning();

  return order;
}

export async function updateOrderSubscription(
  order_no: string,
  sub_id: string,
  sub_interval_count: number,
  sub_cycle_anchor: number,
  sub_period_end: number,
  sub_period_start: number,
  status: string,
  paid_at: string,
  sub_times: number,
  paid_email: string,
  paid_detail: string,
) {
  const [order] = await db()
    .update(orders)
    .set({
      sub_id,
      sub_interval_count,
      sub_cycle_anchor,
      sub_period_end,
      sub_period_start,
      status,
      paid_at: new Date(paid_at),
      sub_times,
      paid_email,
      paid_detail,
    })
    .where(eq(orders.order_no, order_no))
    .returning();

  return order;
}

export async function getOrdersByOrg(
  orgUuid: string,
): Promise<(typeof orders.$inferSelect)[] | undefined> {
  const data = await db()
    .select()
    .from(orders)
    .where(
      and(
        scopedToOrg(orders.org_uuid, orgUuid),
        eq(orders.status, OrderStatus.Paid),
      ),
    )
    .orderBy(desc(orders.created_at));

  return data;
}

export async function getOrdersByUserEmail(
  user_email: string,
): Promise<(typeof orders.$inferSelect)[] | undefined> {
  const data = await db()
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.user_email, user_email),
        eq(orders.status, OrderStatus.Paid),
      ),
    )
    .orderBy(desc(orders.created_at));

  return data;
}

export async function getOrdersByPaidEmail(
  paid_email: string,
): Promise<(typeof orders.$inferSelect)[] | undefined> {
  const data = await db()
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.paid_email, paid_email),
        eq(orders.status, OrderStatus.Paid),
      ),
    )
    .orderBy(desc(orders.created_at));

  return data;
}

export async function getOrderCountByDate(
  startTime: string,
  status?: string,
): Promise<Map<string, number> | undefined> {
  const data = await db()
    .select({ created_at: orders.created_at })
    .from(orders)
    .where(gte(orders.created_at, new Date(startTime)));

  data.sort((a, b) => a.created_at!.getTime() - b.created_at!.getTime());

  const dateCountMap = new Map<string, number>();
  data.forEach((item) => {
    const date = item.created_at!.toISOString().split("T")[0];
    dateCountMap.set(date, (dateCountMap.get(date) || 0) + 1);
  });

  return dateCountMap;
}

export async function findOrderBySubscriptionPeriod(
  sub_id: string,
  sub_period_start: number,
): Promise<typeof orders.$inferSelect | undefined> {
  const [order] = await db()
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.sub_id, sub_id),
        eq(orders.sub_period_start, sub_period_start),
      ),
    )
    .limit(1);
  return order;
}

export async function findOrderByStripePayment(input: {
  paymentIntentId?: string;
  chargeId?: string;
}): Promise<typeof orders.$inferSelect | undefined> {
  const predicate =
    input.paymentIntentId && input.chargeId
      ? or(
          eq(orders.stripe_payment_intent_id, input.paymentIntentId),
          eq(orders.stripe_charge_id, input.chargeId),
        )
      : input.paymentIntentId
        ? eq(orders.stripe_payment_intent_id, input.paymentIntentId)
        : input.chargeId
          ? eq(orders.stripe_charge_id, input.chargeId)
          : undefined;

  if (!predicate) return undefined;

  const [order] = await db().select().from(orders).where(predicate).limit(1);
  return order;
}
