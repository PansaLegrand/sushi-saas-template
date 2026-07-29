/**
 * Reservation route error boundary.
 *
 * Reservations touch auth, availability, Stripe checkout, and email-facing
 * contact data. If that orchestration throws, the route must return a cataloged
 * error rather than leaking provider or database details to the browser.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCacheForTests } from "@/lib/env";
import { resetRateLimitForTests } from "@/lib/rate-limit";
import { postJson } from "../helpers/request";

const mocks = vi.hoisted(() => ({
  createReservationAndCheckout:
    vi.fn<
      typeof import("@/services/reservations").createReservationAndCheckout
    >(),
  getOrgContext:
    vi.fn<typeof import("@/services/authz").getOrgContext>(),
}));

vi.mock("@/config/reservations", () => ({
  ReservationsConfig: {
    enabled: true,
  },
}));

vi.mock("@/services/reservations", () => ({
  createReservationAndCheckout: mocks.createReservationAndCheckout,
}));

// The routes resolve their tenant through `getOrgContext`, which pulls in the
// real Better Auth instance (and therefore a real database) if left unmocked.
vi.mock("@/services/authz", () => ({
  getOrgContext: mocks.getOrgContext,
  getOrgContextFromHeaders: vi
    .fn()
    .mockResolvedValue({
      userId: "id-test",
      userUuid: "u-test",
      orgId: "id-org-test",
      orgUuid: "org-test" as never,
      orgSlug: "test-org",
      orgName: "Test Org",
      orgIsPersonal: false,
      role: "owner",
    }),
  can: () => true,
}));


import { POST as createReservation } from "@/app/api/reservations/route";

function request(body: unknown) {
  return postJson("/api/reservations", body, {
    headers: {
      "idempotency-key": "019faa72-2af9-7a53-9fd2-a88ccf0f47aa",
    },
  });
}

describe("POST /api/reservations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RATE_LIMIT_REDIS_URL;
    resetEnvCacheForTests();
    resetRateLimitForTests();
    mocks.getOrgContext.mockResolvedValue({
      userId: "id-test",
      userUuid: "u-test",
      orgId: "id-org-test",
      orgUuid: "org-test" as never,
      orgSlug: "test-org",
      orgName: "Test Org",
      orgIsPersonal: false,
      role: "owner",
    });
    mocks.createReservationAndCheckout.mockResolvedValue({
      checkout_url: "https://checkout.stripe.test/session",
      reservation_no: "res_1",
      order_no: "order_1",
      session_id: "cs_1",
      reused: false,
    });
  });

  it("does not reach the reservation service before the auth gate", async () => {
    mocks.getOrgContext.mockResolvedValueOnce(null);

    const res = await createReservation(
      request({
        service_id: 1,
        start_at: "2026-01-01T10:00:00.000Z",
        timezone: "UTC",
      })
    );

    expect(res.status).toBe(401);
    expect(mocks.createReservationAndCheckout).not.toHaveBeenCalled();
  });

  it("returns a normal response envelope on success", async () => {
    const res = await createReservation(
      request({
        service_id: 1,
        start_at: "2026-01-01T10:00:00.000Z",
        timezone: "UTC",
      })
    );

    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.checkout_url).toContain("checkout.stripe.test");
    expect(mocks.createReservationAndCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        org_uuid: "org-test",
        user_uuid: "u-test",
        checkout_intent_id: "019faa72-2af9-7a53-9fd2-a88ccf0f47aa",
      })
    );
  });

  it("requires a browser checkout intent", async () => {
    const req = request({
      service_id: 1,
      start_at: "2026-01-01T10:00:00.000Z",
      timezone: "UTC",
    });
    req.headers.delete("idempotency-key");

    const res = await createReservation(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error_code).toBe("REQUEST_MISSING_FIELD");
    expect(mocks.createReservationAndCheckout).not.toHaveBeenCalled();
  });

  it("passes the same intent through on an HTTP replay", async () => {
    const payload = {
      service_id: 1,
      start_at: "2026-01-01T10:00:00.000Z",
      timezone: "UTC",
    };

    await createReservation(request(payload));
    await createReservation(request(payload));

    expect(mocks.createReservationAndCheckout).toHaveBeenCalledTimes(2);
    expect(
      mocks.createReservationAndCheckout.mock.calls.map(
        ([input]) => input.checkout_intent_id
      )
    ).toEqual([
      "019faa72-2af9-7a53-9fd2-a88ccf0f47aa",
      "019faa72-2af9-7a53-9fd2-a88ccf0f47aa",
    ]);
  });

  it("does not leak thrown provider details", async () => {
    const secret = "sk_live_should_not_be_in_the_response";
    mocks.createReservationAndCheckout.mockRejectedValueOnce(new Error(secret));

    const res = await createReservation(
      request({
        service_id: 1,
        start_at: "2026-01-01T10:00:00.000Z",
        timezone: "UTC",
      })
    );
    const body = await res.json();
    const serialized = JSON.stringify(body);

    expect(res.status).toBe(500);
    expect(body.error_code).toBe("RESERVATION_CREATE_FAILED");
    expect(serialized).not.toContain(secret);
  });
});
