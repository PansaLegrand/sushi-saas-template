import { orders } from "@/db/schema";
import { db } from "@/db";
import { asc, desc, eq, gte } from "drizzle-orm";
import { and } from "drizzle-orm";

export enum OrderStatus {
  Created = "created",
  Paid = "paid",
  Deleted = "deleted",
}

export async function insertOrder(data: typeof orders.$inferInsert) {
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

export async function findOrderByOrderNo(
  order_no: string
): Promise<typeof orders.$inferSelect | undefined> {
  const [order] = await db()
    .select()
    .from(orders)
    .where(eq(orders.order_no, order_no))
    .limit(1);

  return order;
}

export async function getFirstPaidOrderByUserUuid(
  user_uuid: string
): Promise<typeof orders.$inferSelect | undefined> {
  const [order] = await db()
    .select()
    .from(orders)
    .where(
      and(eq(orders.user_uuid, user_uuid), eq(orders.status, OrderStatus.Paid))
    )
    .orderBy(asc(orders.created_at))
    .limit(1);

  return order;
}

export async function getFirstPaidOrderByUserEmail(
  user_email: string
): Promise<typeof orders.$inferSelect | undefined> {
  const [order] = await db()
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.user_email, user_email),
        eq(orders.status, OrderStatus.Paid)
      )
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
  paid_detail: string
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
  order_detail: string
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
  paid_detail: string
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

export async function getOrdersByUserUuid(
  user_uuid: string
): Promise<(typeof orders.$inferSelect)[] | undefined> {
  const data = await db()
    .select()
    .from(orders)
    .where(
      and(eq(orders.user_uuid, user_uuid), eq(orders.status, OrderStatus.Paid))
    )
    .orderBy(desc(orders.created_at));

  return data;
}

export async function getOrdersByUserEmail(
  user_email: string
): Promise<(typeof orders.$inferSelect)[] | undefined> {
  const data = await db()
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.user_email, user_email),
        eq(orders.status, OrderStatus.Paid)
      )
    )
    .orderBy(desc(orders.created_at));

  return data;
}

export async function getOrdersByPaidEmail(
  paid_email: string
): Promise<(typeof orders.$inferSelect)[] | undefined> {
  const data = await db()
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.paid_email, paid_email),
        eq(orders.status, OrderStatus.Paid)
      )
    )
    .orderBy(desc(orders.created_at));

  return data;
}

export async function getPaiedOrders(
  page: number,
  limit: number
): Promise<(typeof orders.$inferSelect)[] | undefined> {
  const data = await db()
    .select()
    .from(orders)
    .where(eq(orders.status, OrderStatus.Paid))
    .orderBy(desc(orders.created_at))
    .limit(limit)
    .offset((page - 1) * limit);

  return data;
}

export async function getPaidOrdersTotal(): Promise<number | undefined> {
  const total = await db().$count(orders);

  return total;
}

export async function getOrderCountByDate(
  startTime: string,
  status?: string
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
