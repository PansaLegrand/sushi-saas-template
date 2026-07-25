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

const mocks = vi.hoisted(() => ({
  createReservationAndCheckout: vi.fn(),
  getUserUuid: vi.fn(),
}));

vi.mock("@/config/reservations", () => ({
  ReservationsConfig: {
    enabled: true,
  },
}));

vi.mock("@/services/reservations", () => ({
  createReservationAndCheckout: mocks.createReservationAndCheckout,
}));

vi.mock("@/services/user", () => ({
  getUserUuid: mocks.getUserUuid,
}));

import { POST as createReservation } from "@/app/api/reservations/route";

function request(body: unknown) {
  return new Request("http://test/api/reservations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/reservations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RATE_LIMIT_REDIS_REST_URL;
    delete process.env.RATE_LIMIT_REDIS_REST_TOKEN;
    resetEnvCacheForTests();
    resetRateLimitForTests();
    mocks.getUserUuid.mockResolvedValue("u-test");
    mocks.createReservationAndCheckout.mockResolvedValue({
      checkout_url: "https://checkout.stripe.test/session",
      reservation_no: "res_1",
      order_no: "order_1",
    });
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
