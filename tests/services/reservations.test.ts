/**
 * Reservation checkout orchestration and replay guarantees.
 *
 * Without this file, a retry can mint a new reservation/order pair or reach
 * Stripe under a fresh key even though PostgreSQL correctly collapsed the
 * browser intent.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  Reservation,
  ReservationCheckoutClaim,
  ReservationOrder,
  ReservationService,
} from "@/models/reservation";

const mocks = vi.hoisted(() => ({
  getServiceById:
    vi.fn<typeof import("@/models/reservation").getServiceById>(),
  hasConflict:
    vi.fn<typeof import("@/models/reservation").hasConflict>(),
  claimReservationCheckout:
    vi.fn<typeof import("@/models/reservation").claimReservationCheckout>(),
  confirmReservationPayment:
    vi.fn<typeof import("@/models/reservation").confirmReservationPayment>(),
  expireReservationCheckoutSession:
    vi.fn<
      typeof import("@/models/reservation").expireReservationCheckoutSession
    >(),
  expireReservationHold:
    vi.fn<typeof import("@/models/reservation").expireReservationHold>(),
  updateOrderSession:
    vi.fn<typeof import("@/models/order").updateOrderSession>(),
  findUserByUuid:
    vi.fn<typeof import("@/models/user").findUserByUuid>(),
  updateAffiliateForOrder:
    vi.fn<typeof import("@/services/affiliate").updateAffiliateForOrder>(),
  enqueueJob: vi.fn<typeof import("@/services/jobs").enqueueJob>(),
  stripeCreate: vi.fn(),
  stripeRetrieve: vi.fn(),
  buildReservationICS: vi.fn(),
  buildGoogleCalendarUrl: vi.fn(),
}));

vi.mock("@/models/reservation", () => ({
  getServiceById: mocks.getServiceById,
  hasConflict: mocks.hasConflict,
  claimReservationCheckout: mocks.claimReservationCheckout,
  confirmReservationPayment: mocks.confirmReservationPayment,
  expireReservationCheckoutSession: mocks.expireReservationCheckoutSession,
  expireReservationHold: mocks.expireReservationHold,
}));

vi.mock("@/models/order", () => ({
  updateOrderSession: mocks.updateOrderSession,
}));

vi.mock("@/models/user", () => ({
  findUserByUuid: mocks.findUserByUuid,
}));

vi.mock("@/services/jobs", () => ({
  enqueueJob: mocks.enqueueJob,
}));

vi.mock("@/services/affiliate", () => ({
  updateAffiliateForOrder: mocks.updateAffiliateForOrder,
}));

vi.mock("@/services/reservations/ics", () => ({
  buildReservationICS: mocks.buildReservationICS,
}));

vi.mock("@/services/reservations/google", () => ({
  buildGoogleCalendarUrl: mocks.buildGoogleCalendarUrl,
}));

vi.mock("@/integrations/stripe", () => ({
  newStripeClient: () => ({
    stripe: () => ({
      checkout: {
        sessions: {
          create: mocks.stripeCreate,
          retrieve: mocks.stripeRetrieve,
        },
      },
    }),
  }),
}));

import {
  createReservationAndCheckout,
  fulfillReservationCheckoutSession,
  getAvailabilityForDate,
} from "@/services/reservations";

const INTENT_ID = "019faa72-2af9-7a53-9fd2-a88ccf0f47aa";
const NOW = new Date("2026-01-01T00:00:00.000Z");
const START = "2026-01-02T17:00:00.000Z"; // 09:00 America/Los_Angeles

function service(overrides: Partial<ReservationService> = {}): ReservationService {
  return {
    id: 1,
    slug: "consultation",
    title: "Consultation",
    description: "A consultation",
    duration_min: 30,
    price: 5_000,
    currency: "usd",
    deposit_amount: 500,
    require_deposit: true,
    cancellation_window_hours: 24,
    buffer_before_min: 5,
    buffer_after_min: 10,
    active: true,
    created_at: NOW,
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    locale: "en",
    org_uuid: "org-1",
    user_uuid: "user-1",
    service_id: 1,
    start_at: START,
    timezone: "America/Los_Angeles",
    checkout_intent_id: INTENT_ID,
    ...overrides,
  };
}

describe("reservation checkout", () => {
  let claims: Map<
    string,
    { reservation: Reservation; order: ReservationOrder }
  >;
  let stripeSessions: Map<
    string,
    { id: string; url: string; status: "open" }
  >;
  let nextId: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    claims = new Map();
    stripeSessions = new Map();
    nextId = 1;

    mocks.getServiceById.mockResolvedValue(service());
    mocks.hasConflict.mockResolvedValue(false);
    mocks.findUserByUuid.mockResolvedValue({
      id: "auth-user-1",
      uuid: "user-1",
      email: "booker@example.test",
    } as never);
    mocks.expireReservationHold.mockResolvedValue(undefined);
    mocks.expireReservationCheckoutSession.mockResolvedValue({
      outcome: "expired",
      reservation: {} as never,
    });
    mocks.enqueueJob.mockResolvedValue({} as never);
    mocks.updateAffiliateForOrder.mockResolvedValue(undefined);
    mocks.buildReservationICS.mockReturnValue("BEGIN:VCALENDAR");
    mocks.buildGoogleCalendarUrl.mockReturnValue(
      "https://calendar.google.test/event"
    );

    mocks.claimReservationCheckout.mockImplementation(async ({ reservation, order }) => {
      const key = `${reservation.org_uuid}:${reservation.user_uuid}:${reservation.checkout_intent_id}`;
      const existing = claims.get(key);
      if (existing) {
        return {
          outcome: "reused",
          reservation: existing.reservation,
          order: existing.order,
        };
      }

      const reservationRow = {
        id: nextId++,
        created_at: NOW,
        contact_email: null,
        contact_phone: null,
        notes: null,
        policy_snapshot: null,
        ...reservation,
      } as Reservation;
      const orderRow = {
        id: nextId++,
        stripe_session_id: null,
        sub_id: null,
        sub_interval_count: null,
        sub_cycle_anchor: null,
        sub_period_end: null,
        sub_period_start: null,
        sub_times: null,
        order_detail: null,
        paid_at: null,
        paid_email: null,
        paid_detail: null,
        stripe_price_id: null,
        ...order,
      } as ReservationOrder;
      claims.set(key, { reservation: reservationRow, order: orderRow });
      return {
        outcome: "created",
        reservation: reservationRow,
        order: orderRow,
      };
    });

    mocks.updateOrderSession.mockImplementation(
      async (orderNo, stripeSessionId, orderDetail) => {
        const claim = [...claims.values()].find(
          ({ order }) => order.order_no === orderNo
        );
        if (!claim) throw new Error(`missing test order: ${orderNo}`);
        claim.order = {
          ...claim.order,
          stripe_session_id: stripeSessionId,
          order_detail: orderDetail,
        };
        return claim.order as never;
      }
    );

    mocks.stripeCreate.mockImplementation(
      async (
        _options: unknown,
        request: { idempotencyKey: string }
      ) => {
        const existing = stripeSessions.get(request.idempotencyKey);
        if (existing) return existing;
        const session = {
          id: `cs_${stripeSessions.size + 1}`,
          url: `https://checkout.stripe.test/cs_${stripeSessions.size + 1}`,
          status: "open" as const,
        };
        stripeSessions.set(request.idempotencyKey, session);
        return session;
      }
    );
    mocks.stripeRetrieve.mockImplementation(async (sessionId: string) =>
      [...stripeSessions.values()].find(({ id }) => id === sessionId)
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replays one browser intent as one reservation, order, and Stripe session", async () => {
    const first = await createReservationAndCheckout(input());
    const second = await createReservationAndCheckout(input());

    expect(claims.size).toBe(1);
    expect(stripeSessions.size).toBe(1);
    expect(second).toMatchObject({
      reservation_no: first.reservation_no,
      order_no: first.order_no,
      session_id: first.session_id,
      checkout_url: first.checkout_url,
      reused: true,
    });
    expect(mocks.stripeCreate).toHaveBeenCalledTimes(1);
    expect(mocks.stripeRetrieve).toHaveBeenCalledWith(first.session_id);
  });

  it("converts configured business hours to real UTC instants", async () => {
    const slots = await getAvailabilityForDate({
      service_id: 1,
      dateISO: "2026-01-02",
      timezone: "Asia/Shanghai",
    });

    expect(slots[0]).toBe("2026-01-02T17:00:00.000Z");
    expect(slots).toHaveLength(16);
  });

  it("collapses concurrent copies of one intent onto one Stripe key", async () => {
    const [first, second] = await Promise.all([
      createReservationAndCheckout(input()),
      createReservationAndCheckout(input()),
    ]);

    expect(claims.size).toBe(1);
    expect(stripeSessions.size).toBe(1);
    expect(first.reservation_no).toBe(second.reservation_no);
    expect(first.order_no).toBe(second.order_no);
    expect(
      new Set(
        mocks.stripeCreate.mock.calls.map(
          (call) => call[1].idempotencyKey
        )
      )
    ).toEqual(new Set([first.order_no]));
  });

  it("rejects one intent reused with different reservation terms", async () => {
    await createReservationAndCheckout(input());

    await expect(
      createReservationAndCheckout(input({ notes: "different terms" }))
    ).rejects.toMatchObject({
      code: "CHECKOUT_INTENT_CONFLICT",
      statusCode: 409,
    });

    expect(claims.size).toBe(1);
    expect(stripeSessions.size).toBe(1);
  });

  it("repairs a crash after Stripe creates the session", async () => {
    mocks.updateOrderSession.mockRejectedValueOnce(
      new Error("database unavailable after Stripe success")
    );

    await expect(
      createReservationAndCheckout(input())
    ).rejects.toThrow("database unavailable");

    const replay = await createReservationAndCheckout(input());

    expect(stripeSessions.size).toBe(1);
    expect(mocks.stripeCreate).toHaveBeenCalledTimes(2);
    expect(
      new Set(
        mocks.stripeCreate.mock.calls.map(
          (call) => call[1].idempotencyKey
        )
      )
    ).toEqual(new Set([replay.order_no]));
    expect(replay.session_id).toBe("cs_1");
  });

  it("surfaces an atomic slot conflict before calling Stripe", async () => {
    mocks.claimReservationCheckout.mockResolvedValueOnce({
      outcome: "conflict",
    } satisfies ReservationCheckoutClaim);

    await expect(
      createReservationAndCheckout(input())
    ).rejects.toMatchObject({
      code: "RESERVATION_SLOT_UNAVAILABLE",
      statusCode: 409,
    });

    expect(mocks.stripeCreate).not.toHaveBeenCalled();
  });

  it("fulfills and queues confirmation through the atomic payment model", async () => {
    const reservation = {
      id: 1,
      reservation_no: "reservation-1",
      service_id: 1,
      start_at: new Date(START),
      end_at: new Date("2026-01-02T17:30:00.000Z"),
      timezone: "America/Los_Angeles",
    } as Reservation;
    const order = {
      order_no: "order-1",
      product_name: "Reservation: Consultation",
      checkout_locale: "en",
    } as ReservationOrder;
    mocks.confirmReservationPayment.mockResolvedValue({
      outcome: "confirmed",
      reservation,
      order,
    });

    await fulfillReservationCheckoutSession({
      id: "cs_1",
      metadata: {
        type: "reservation",
        reservation_no: "reservation-1",
        order_no: "order-1",
      },
      customer_details: { email: "booker@example.test" },
    } as never);

    expect(mocks.confirmReservationPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationNo: "reservation-1",
        orderNo: "order-1",
        stripeSessionId: "cs_1",
      })
    );
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      "reservation_confirmed_email",
      expect.objectContaining({ reservationNo: "reservation-1" }),
      { dedupeKey: "reservation_confirmed_email:reservation-1" }
    );
  });
});
