import {
  and,
  eq,
  gt,
  inArray,
  lt,
  lte,
  notExists,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  reservationServices,
  reservations,
  orders,
} from "@/db/schema";

import { scopedToOrg } from "./organization";

export type ReservationService = typeof reservationServices.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
export type ReservationOrder = typeof orders.$inferSelect;
/** An open transaction, as handed to the callback of `db().transaction()`. */
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export async function ensureDemoService(): Promise<ReservationService> {
  const [existing] = await db()
    .select()
    .from(reservationServices)
    .where(eq(reservationServices.slug, "demo-consultation"))
    .limit(1);
  if (existing) return existing;

  const [inserted] = await db()
    .insert(reservationServices)
    .values({
      slug: "demo-consultation",
      title: "Demo Consultation",
      description: "30-minute consultation for demo purposes",
      duration_min: 30,
      price: 5000, // $50 demo price
      currency: "usd",
      deposit_amount: 500, // $5 deposit
      require_deposit: true,
      cancellation_window_hours: 24,
      buffer_before_min: 0,
      buffer_after_min: 0,
      active: true,
    })
    .onConflictDoNothing({ target: reservationServices.slug })
    .returning();

  if (inserted) return inserted;

  const [svc] = await db()
    .select()
    .from(reservationServices)
    .where(eq(reservationServices.slug, "demo-consultation"))
    .limit(1);
  return svc;
}

export async function listActiveServices(): Promise<ReservationService[]> {
  const data = await db()
    .select()
    .from(reservationServices)
    .where(eq(reservationServices.active, true));
  return data;
}

export async function getServiceById(id: number): Promise<ReservationService | undefined> {
  const [svc] = await db()
    .select()
    .from(reservationServices)
    .where(eq(reservationServices.id, id))
    .limit(1);
  return svc;
}

type ReservationInsert = typeof reservations.$inferInsert & {
  org_uuid: string;
  user_uuid: string;
  checkout_intent_id: string;
  checkout_fingerprint: string;
};

type ReservationOrderInsert = typeof orders.$inferInsert & {
  org_uuid: string;
};

export type ReservationCheckoutClaim =
  | {
      outcome: "created" | "reused";
      reservation: Reservation;
      order: ReservationOrder | null;
    }
  | { outcome: "conflict" };

async function findCheckoutClaim(
  tx: Tx,
  input: {
    orgUuid: string;
    userUuid: string;
    checkoutIntentId: string;
  }
): Promise<
  { reservation: Reservation; order: ReservationOrder | null } | undefined
> {
  const [row] = await tx
    .select({ reservation: reservations, order: orders })
    .from(reservations)
    .leftJoin(orders, eq(reservations.order_no, orders.order_no))
    .where(
      and(
        scopedToOrg(reservations.org_uuid, input.orgUuid),
        eq(reservations.user_uuid, input.userUuid),
        eq(reservations.checkout_intent_id, input.checkoutIntentId)
      )
    )
    .limit(1);

  return row;
}

async function expireReleasableHolds(
  tx: Tx,
  serviceId: number,
  now: Date
): Promise<void> {
  await tx
    .update(reservations)
    .set({ status: "expired" })
    .where(
      and(
        eq(reservations.service_id, serviceId),
        eq(reservations.status, "pending"),
        lte(reservations.hold_expires_at, now),
        // A persisted Stripe session is released only by a verified
        // `checkout.session.expired` event. If that webhook is delayed, the
        // slot stays held rather than being sold while Stripe can still
        // complete the original payment.
        notExists(
          tx
            .select({ id: orders.id })
            .from(orders)
            .where(
              and(
                eq(orders.order_no, reservations.order_no),
                sql`${orders.stripe_session_id} is not null`
              )
            )
        )
      )
    );
}

/**
 * Claim one checkout intent, one order, and one time range atomically.
 *
 * The intent lock makes a replay wait for the first transaction and then read
 * its rows. The service lock serializes expiration and overlap checks. The
 * exclusion constraint in migration 0025 remains the final boundary if a
 * future writer forgets either lock.
 */
export async function claimReservationCheckout(input: {
  reservation: ReservationInsert;
  order: ReservationOrderInsert;
  now: Date;
}): Promise<ReservationCheckoutClaim> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(
          ${`reservation-intent:${input.reservation.org_uuid}:${input.reservation.user_uuid}:${input.reservation.checkout_intent_id}`},
          0::bigint
        )
      )
    `);

    const existing = await findCheckoutClaim(tx, {
      orgUuid: input.reservation.org_uuid,
      userUuid: input.reservation.user_uuid,
      checkoutIntentId: input.reservation.checkout_intent_id,
    });
    if (existing) {
      return { outcome: "reused", ...existing };
    }

    // All writers lock by service id in the same order: intent first, service
    // second. This keeps different intents from deadlocking one another.
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        1381192257,
        ${input.reservation.service_id}
      )
    `);

    // Time does not change a partial-index predicate on its own. Move elapsed
    // holds out of the exclusion constraint before looking for free space.
    await expireReleasableHolds(
      tx,
      input.reservation.service_id,
      input.now
    );

    const [conflict] = await tx
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.service_id, input.reservation.service_id),
          inArray(reservations.status, ["pending", "confirmed"]),
          lt(
            reservations.blocked_start_at,
            input.reservation.blocked_end_at
          ),
          gt(
            reservations.blocked_end_at,
            input.reservation.blocked_start_at
          )
        )
      )
      .limit(1);

    if (conflict) return { outcome: "conflict" };

    const [order] = await tx.insert(orders).values(input.order).returning();
    const [reservation] = await tx
      .insert(reservations)
      .values(input.reservation)
      .returning();

    return { outcome: "created", reservation, order };
  });
}

export type ReservationPaymentOutcome =
  | {
      outcome: "confirmed" | "replayed";
      reservation: Reservation;
      order: ReservationOrder;
    }
  | {
      outcome:
        | "not_found"
        | "order_mismatch"
        | "session_mismatch"
        | "payment_mismatch"
        | "unfulfillable";
    };

/**
 * Record paid money and confirm its slot in one transaction.
 *
 * A paid order without a confirmed reservation is an incident, not an
 * acceptable intermediate state. The service lock also makes the expiry/new
 * booking path and a payment arriving at the hold boundary choose one winner.
 */
export async function confirmReservationPayment(input: {
  reservationNo: string;
  orderNo: string;
  stripeSessionId: string;
  paidAt: Date;
  paidEmail: string;
  paidDetail: string;
  amountPaid: number | null;
  currency: string | null;
}): Promise<ReservationPaymentOutcome> {
  return db().transaction(async (tx) => {
    const [initial] = await tx
      .select({ serviceId: reservations.service_id })
      .from(reservations)
      .where(eq(reservations.reservation_no, input.reservationNo))
      .limit(1);
    if (!initial) return { outcome: "not_found" };

    await tx.execute(sql`
      select pg_advisory_xact_lock(1381192257, ${initial.serviceId})
    `);

    const [row] = await tx
      .select({ reservation: reservations, order: orders })
      .from(reservations)
      .leftJoin(orders, eq(reservations.order_no, orders.order_no))
      .where(eq(reservations.reservation_no, input.reservationNo))
      .limit(1);

    if (!row?.order) return { outcome: "not_found" };
    if (
      row.reservation.order_no !== input.orderNo ||
      row.order.order_no !== input.orderNo
    ) {
      return { outcome: "order_mismatch" };
    }
    if (
      row.order.stripe_session_id &&
      row.order.stripe_session_id !== input.stripeSessionId
    ) {
      return { outcome: "session_mismatch" };
    }
    if (
      input.amountPaid !== row.order.amount ||
      input.currency?.toLowerCase() !== row.order.currency?.toLowerCase()
    ) {
      return { outcome: "payment_mismatch" };
    }
    if (
      row.reservation.status === "canceled" ||
      row.reservation.status === "expired"
    ) {
      return { outcome: "unfulfillable" };
    }

    const replayed =
      row.reservation.status === "confirmed" && row.order.status === "paid";

    const [reservation] = await tx
      .update(reservations)
      .set({ status: "confirmed", hold_expires_at: null })
      .where(eq(reservations.id, row.reservation.id))
      .returning();
    const [order] = await tx
      .update(orders)
      .set({
        status: "paid",
        stripe_session_id: input.stripeSessionId,
        paid_at: input.paidAt,
        paid_email: input.paidEmail,
        paid_detail: input.paidDetail,
      })
      .where(eq(orders.id, row.order.id))
      .returning();

    return {
      outcome: replayed ? "replayed" : "confirmed",
      reservation,
      order,
    };
  });
}

export async function expireReservationHold(
  reservationNo: string,
  now: Date
): Promise<Reservation | undefined> {
  const database = db();
  const [row] = await database
    .update(reservations)
    .set({ status: "expired" })
    .where(
      and(
        eq(reservations.reservation_no, reservationNo),
        eq(reservations.status, "pending"),
        lte(reservations.hold_expires_at, now),
        notExists(
          database
            .select({ id: orders.id })
            .from(orders)
            .where(
              and(
                eq(orders.order_no, reservations.order_no),
                sql`${orders.stripe_session_id} is not null`
              )
            )
        )
      )
    )
    .returning();
  return row;
}

export type ReservationExpirationOutcome =
  | { outcome: "expired" | "replayed"; reservation: Reservation }
  | { outcome: "not_found" | "order_mismatch" | "session_mismatch" | "confirmed" };

/** Release a slot only for the Stripe session that owned its payment hold. */
export async function expireReservationCheckoutSession(input: {
  reservationNo: string;
  orderNo: string;
  stripeSessionId: string;
}): Promise<ReservationExpirationOutcome> {
  return db().transaction(async (tx) => {
    const [initial] = await tx
      .select({ serviceId: reservations.service_id })
      .from(reservations)
      .where(eq(reservations.reservation_no, input.reservationNo))
      .limit(1);
    if (!initial) return { outcome: "not_found" };

    await tx.execute(sql`
      select pg_advisory_xact_lock(1381192257, ${initial.serviceId})
    `);

    const [row] = await tx
      .select({ reservation: reservations, order: orders })
      .from(reservations)
      .leftJoin(orders, eq(reservations.order_no, orders.order_no))
      .where(eq(reservations.reservation_no, input.reservationNo))
      .limit(1);

    if (!row?.order) return { outcome: "not_found" };
    if (
      row.reservation.order_no !== input.orderNo ||
      row.order.order_no !== input.orderNo
    ) {
      return { outcome: "order_mismatch" };
    }
    if (
      row.order.stripe_session_id &&
      row.order.stripe_session_id !== input.stripeSessionId
    ) {
      return { outcome: "session_mismatch" };
    }
    if (row.reservation.status === "confirmed") {
      return { outcome: "confirmed" };
    }
    if (
      row.reservation.status === "expired" ||
      row.reservation.status === "canceled"
    ) {
      return { outcome: "replayed", reservation: row.reservation };
    }

    const [reservation] = await tx
      .update(reservations)
      .set({ status: "expired" })
      .where(eq(reservations.id, row.reservation.id))
      .returning();
    await tx
      .update(orders)
      .set({ stripe_session_id: input.stripeSessionId })
      .where(eq(orders.id, row.order.id));

    return { outcome: "expired", reservation };
  });
}

export async function findReservationByOrderNo(order_no: string): Promise<Reservation | undefined> {
  const [row] = await db()
    .select()
    .from(reservations)
    .where(eq(reservations.order_no, order_no))
    .limit(1);
  return row;
}

export async function findReservationByNo(reservation_no: string): Promise<Reservation | undefined> {
  const [row] = await db()
    .select()
    .from(reservations)
    .where(eq(reservations.reservation_no, reservation_no))
    .limit(1);
  return row;
}

export async function hasConflict(params: {
  service_id: number;
  start_at: Date;
  end_at: Date;
}): Promise<boolean> {
  const now = new Date();
  return db().transaction(async (tx) => {
    await tx.execute(sql`
      select pg_advisory_xact_lock(1381192257, ${params.service_id})
    `);
    await expireReleasableHolds(tx, params.service_id, now);

    const [result] = await tx
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.service_id, params.service_id),
          inArray(reservations.status, ["pending", "confirmed"]),
          // Half-open overlap: adjacent ranges do not conflict.
          lt(reservations.blocked_start_at, params.end_at),
          gt(reservations.blocked_end_at, params.start_at)
        )
      )
      .limit(1);
    return Boolean(result);
  });
}

export async function listOrgReservations(orgUuid: string): Promise<Reservation[]> {
  const rows = await db()
    .select()
    .from(reservations)
    .where(scopedToOrg(reservations.org_uuid, orgUuid));
  return rows;
}

export async function listOrgReservationsWithService(orgUuid: string): Promise<Array<Reservation & { service: ReservationService }>> {
  const rows = await db()
    .select({
      r: reservations,
      s: reservationServices,
    })
    .from(reservations)
    .leftJoin(reservationServices, eq(reservations.service_id, reservationServices.id))
    .where(scopedToOrg(reservations.org_uuid, orgUuid));
  return rows.map((row: any) => ({ ...row.r, service: row.s }));
}
