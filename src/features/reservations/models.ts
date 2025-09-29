import { and, eq, gte, lt, or } from "drizzle-orm";
import { db } from "@/db";
import {
  reservationServices,
  reservations,
  orders,
} from "@/db/schema";
import { getSnowId } from "@/lib/hash";
import { ReservationsConfig } from "@/features/reservations/config";

export type ReservationService = typeof reservationServices.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;

export async function ensureDemoService(): Promise<ReservationService> {
  const [existing] = await db()
    .select()
    .from(reservationServices)
    .limit(1);
  if (existing) return existing;

  const [svc] = await db()
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
    .returning();
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

export async function createReservation(params: {
  user_uuid: string;
  service_id: number;
  start_at: Date;
  end_at: Date;
  timezone: string;
  contact_email?: string;
  contact_phone?: string;
  notes?: string;
  policy_snapshot?: string;
}): Promise<Reservation> {
  const [row] = await db()
    .insert(reservations)
    .values({
      reservation_no: String(getSnowId()),
      user_uuid: params.user_uuid,
      service_id: params.service_id,
      start_at: params.start_at,
      end_at: params.end_at,
      timezone: params.timezone,
      status: "pending",
      hold_expires_at: new Date(Date.now() + ReservationsConfig.holdMinutes * 60 * 1000),
      contact_email: params.contact_email,
      contact_phone: params.contact_phone,
      notes: params.notes,
      policy_snapshot: params.policy_snapshot,
    })
    .returning();
  return row;
}

export async function attachOrderToReservation(
  reservation_no: string,
  order_no: string
) {
  const [row] = await db()
    .update(reservations)
    .set({ order_no })
    .where(eq(reservations.reservation_no, reservation_no))
    .returning();
  return row;
}

export async function markReservationConfirmed(
  reservation_no: string
): Promise<Reservation | undefined> {
  const [row] = await db()
    .update(reservations)
    .set({ status: "confirmed" })
    .where(eq(reservations.reservation_no, reservation_no))
    .returning();
  return row;
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
  const results = await db()
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.service_id, params.service_id),
        // overlap if (start < existing.end && end > existing.start)
        lt(reservations.start_at, params.end_at),
        gte(reservations.end_at, params.start_at),
        // Consider 'confirmed' or 'pending' not yet expired holds
        or(
          eq(reservations.status, "confirmed"),
          and(
            eq(reservations.status, "pending"),
            or(
              // No hold expiry set
              eq(reservations.hold_expires_at, null as any),
              gte(reservations.hold_expires_at, now)
            )
          )
        )
      )
    );
  return results.length > 0;
}

export async function listUserReservations(user_uuid: string): Promise<Reservation[]> {
  const rows = await db()
    .select()
    .from(reservations)
    .where(eq(reservations.user_uuid, user_uuid));
  return rows;
}

export async function listUserReservationsWithService(user_uuid: string): Promise<Array<Reservation & { service: ReservationService }>> {
  const rows = await db()
    .select({
      r: reservations,
      s: reservationServices,
    })
    .from(reservations)
    .leftJoin(reservationServices, eq(reservations.service_id, reservationServices.id))
    .where(eq(reservations.user_uuid, user_uuid));
  return rows.map((row: any) => ({ ...row.r, service: row.s }));
}

export async function listReservationsWithServiceAdmin(page: number = 1, limit: number = 50): Promise<Array<Reservation & { service: ReservationService }>> {
  const offset = (page - 1) * limit;
  const rows = await db()
    .select({ r: reservations, s: reservationServices })
    .from(reservations)
    .leftJoin(reservationServices, eq(reservations.service_id, reservationServices.id))
    .orderBy(reservations.start_at)
    .limit(limit)
    .offset(offset);
  return rows.map((row: any) => ({ ...row.r, service: row.s }));
}
