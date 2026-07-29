/**
 * Database tier: reservation intent and time-range exclusion.
 *
 * Service mocks cannot prove that two application instances share a lock or
 * that PostgreSQL rejects an overlapping writer which bypasses the model.
 */
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

import { db } from "@/db";
import { reservations } from "@/db/schema";
import {
  claimReservationCheckout,
  confirmReservationPayment,
  ensureDemoService,
} from "@/models/reservation";
import { describeDb, errorCode, useCleanDatabase } from "./setup";

useCleanDatabase();

const START = new Date("2027-01-04T17:00:00.000Z");
const END = new Date("2027-01-04T17:30:00.000Z");

function claim(input: {
  serviceId: number;
  intentId?: string;
  reservationNo?: string;
  orderNo?: string;
  start?: Date;
  end?: Date;
  blockedStart?: Date;
  blockedEnd?: Date;
  now?: Date;
}) {
  const intentId = input.intentId ?? randomUUID();
  const reservationNo = input.reservationNo ?? randomUUID();
  const orderNo = input.orderNo ?? randomUUID();
  const start = input.start ?? START;
  const end = input.end ?? END;

  return claimReservationCheckout({
    now: input.now ?? new Date("2027-01-01T00:00:00.000Z"),
    reservation: {
      reservation_no: reservationNo,
      org_uuid: "org-1",
      user_uuid: "user-1",
      service_id: input.serviceId,
      start_at: start,
      end_at: end,
      blocked_start_at: input.blockedStart ?? start,
      blocked_end_at: input.blockedEnd ?? end,
      timezone: "America/Los_Angeles",
      status: "pending",
      hold_expires_at: new Date("2027-01-04T18:00:00.000Z"),
      order_no: orderNo,
      checkout_intent_id: intentId,
      checkout_fingerprint: "a".repeat(64),
    },
    order: {
      order_no: orderNo,
      created_at: new Date("2027-01-01T00:00:00.000Z"),
      org_uuid: "org-1",
      user_uuid: "user-1",
      user_email: "booker@example.test",
      amount: 500,
      interval: "one-time",
      status: "created",
      credits: 0,
      currency: "usd",
      product_id: "reservation:demo-consultation",
      product_name: "Reservation: Demo Consultation",
      valid_months: 0,
      checkout_intent_id: `reservation:${intentId}`,
      checkout_fingerprint: "a".repeat(64),
      checkout_locale: "en",
    },
  });
}

describeDb("reservation concurrency", () => {
  it("creates one reservation and order for concurrent copies of one intent", async () => {
    const service = await ensureDemoService();
    const intentId = randomUUID();

    const [first, second] = await Promise.all([
      claim({
        serviceId: service.id,
        intentId,
        reservationNo: "reservation-1",
        orderNo: "order-1",
      }),
      claim({
        serviceId: service.id,
        intentId,
        reservationNo: "reservation-2",
        orderNo: "order-2",
      }),
    ]);

    expect([first.outcome, second.outcome].sort()).toEqual([
      "created",
      "reused",
    ]);
    if (first.outcome === "conflict" || second.outcome === "conflict") {
      throw new Error("same-intent requests must never conflict");
    }
    expect(first.reservation.reservation_no).toBe(
      second.reservation.reservation_no
    );
    expect(first.order?.order_no).toBe(second.order?.order_no);
  });

  it("allows one winner when different intents race for one slot", async () => {
    const service = await ensureDemoService();

    const outcomes = await Promise.all([
      claim({
        serviceId: service.id,
        reservationNo: "reservation-1",
        orderNo: "order-1",
      }),
      claim({
        serviceId: service.id,
        reservationNo: "reservation-2",
        orderNo: "order-2",
      }),
    ]);

    expect(outcomes.map(({ outcome }) => outcome).sort()).toEqual([
      "conflict",
      "created",
    ]);
  });

  it("keeps an exclusion constraint behind the model lock", async () => {
    const service = await ensureDemoService();
    const base = {
      org_uuid: "org-1",
      user_uuid: "user-1",
      service_id: service.id,
      start_at: START,
      end_at: END,
      blocked_start_at: START,
      blocked_end_at: END,
      timezone: "America/Los_Angeles",
      status: "confirmed",
    };

    await db().insert(reservations).values({
      ...base,
      reservation_no: "direct-1",
    });

    let caught: unknown;
    try {
      await db().insert(reservations).values({
        ...base,
        reservation_no: "direct-2",
        start_at: new Date("2027-01-04T17:15:00.000Z"),
        end_at: new Date("2027-01-04T17:45:00.000Z"),
        blocked_start_at: new Date("2027-01-04T17:15:00.000Z"),
        blocked_end_at: new Date("2027-01-04T17:45:00.000Z"),
      });
    } catch (error) {
      caught = error;
    }

    expect(errorCode(caught)).toBe("23P01");
  });

  it("uses half-open ranges so adjacent slots remain bookable", async () => {
    const service = await ensureDemoService();
    const first = await claim({
      serviceId: service.id,
      reservationNo: "reservation-1",
      orderNo: "order-1",
    });
    const second = await claim({
      serviceId: service.id,
      reservationNo: "reservation-2",
      orderNo: "order-2",
      start: END,
      end: new Date("2027-01-04T18:00:00.000Z"),
      blockedStart: END,
      blockedEnd: new Date("2027-01-04T18:00:00.000Z"),
    });

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("created");
  });

  it("atomically confirms paid money once and safely replays it", async () => {
    const service = await ensureDemoService();
    const created = await claim({
      serviceId: service.id,
      reservationNo: "reservation-paid",
      orderNo: "order-paid",
    });
    expect(created.outcome).toBe("created");

    const payment = {
      reservationNo: "reservation-paid",
      orderNo: "order-paid",
      stripeSessionId: "cs_paid",
      paidAt: new Date("2027-01-01T01:00:00.000Z"),
      paidEmail: "booker@example.test",
      paidDetail: "{\"paid\":true}",
      amountPaid: 500,
      currency: "usd",
    };
    const first = await confirmReservationPayment(payment);
    const replay = await confirmReservationPayment(payment);

    expect(first).toMatchObject({
      outcome: "confirmed",
      reservation: { status: "confirmed" },
      order: { status: "paid", stripe_session_id: "cs_paid" },
    });
    expect(replay).toMatchObject({
      outcome: "replayed",
      reservation: { status: "confirmed" },
      order: { status: "paid", stripe_session_id: "cs_paid" },
    });
  });
});
