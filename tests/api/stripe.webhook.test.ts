import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  handleCheckoutSession: vi.fn(),
  enqueueJob: vi.fn(),
  claimStripeWebhookEvent: vi.fn(),
  markStripeWebhookEventCompleted: vi.fn(),
  markStripeWebhookEventFailed: vi.fn(),
}));

vi.mock("stripe", () => {
  class StripeMock {
    static webhooks = {
      constructEvent: mocks.constructEvent,
    };
  }

  return { default: StripeMock };
});

vi.mock("@/services/stripe", () => ({
  handleCheckoutSession: mocks.handleCheckoutSession,
}));

vi.mock("@/services/jobs", () => ({
  enqueueJob: mocks.enqueueJob,
}));

vi.mock("@/models/stripe-webhook-event", () => ({
  claimStripeWebhookEvent: mocks.claimStripeWebhookEvent,
  markStripeWebhookEventCompleted: mocks.markStripeWebhookEventCompleted,
  markStripeWebhookEventFailed: mocks.markStripeWebhookEventFailed,
}));

vi.mock("@/services/email/send", () => ({
  sendPaymentSuccessEmail: vi.fn().mockResolvedValue(undefined),
  sendPaymentFailedEmail: vi.fn().mockResolvedValue(undefined),
  sendReservationConfirmedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/config/reservations", () => ({
  ReservationsConfig: {
    enabled: false,
    baseTimeZone: "UTC",
  },
}));

vi.mock("@/models/reservation", () => ({
  markReservationConfirmed: vi.fn(),
  findReservationByNo: vi.fn(),
  getServiceById: vi.fn(),
}));

vi.mock("@/services/reservations/ics", () => ({
  buildReservationICS: vi.fn(),
}));

vi.mock("@/services/reservations/google", () => ({
  buildGoogleCalendarUrl: vi.fn(),
}));

vi.mock("@/integrations/slack", () => ({
  notifySlackEvent: vi.fn(),
  notifySlackError: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getRequiredEnv: vi.fn((key: string) => `${key}_test`),
  getAppEnv: vi.fn(() => ({
    NEXT_PUBLIC_WEB_URL: "http://localhost:3000",
  })),
}));

import { POST as stripeWebhook } from "@/app/api/pay/webhook/stripe/route";

function checkoutEvent(id = "evt_checkout_1") {
  return {
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        metadata: {
          order_no: "order_1",
        },
        customer_details: null,
      },
    },
  };
}

function request() {
  return new Request("http://localhost/api/pay/webhook/stripe", {
    method: "POST",
    headers: {
      "stripe-signature": "test-signature",
    },
    body: JSON.stringify({ ok: true }),
  });
}

describe("POST /api/pay/webhook/stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.constructEvent.mockReturnValue(checkoutEvent());
    mocks.claimStripeWebhookEvent.mockResolvedValue("claimed");
    mocks.markStripeWebhookEventCompleted.mockResolvedValue(undefined);
    mocks.markStripeWebhookEventFailed.mockResolvedValue(undefined);
    mocks.handleCheckoutSession.mockResolvedValue(undefined);
    mocks.enqueueJob.mockResolvedValue(undefined);
  });

  it("claims and completes a new Stripe event", async () => {
    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.claimStripeWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_checkout_1",
        eventType: "checkout.session.completed",
      })
    );
    expect(mocks.handleCheckoutSession).toHaveBeenCalledTimes(1);
    expect(mocks.markStripeWebhookEventCompleted).toHaveBeenCalledWith("evt_checkout_1");
    expect(mocks.markStripeWebhookEventFailed).not.toHaveBeenCalled();
  });

  it("enqueues checkout notification side effects durably", async () => {
    mocks.constructEvent.mockReturnValue({
      ...checkoutEvent("evt_checkout_email"),
      data: {
        object: {
          id: "cs_test_1",
          mode: "payment",
          metadata: { order_no: "order_1" },
          customer_details: { email: "buyer@example.com" },
          amount_total: 2500,
          currency: "usd",
        },
      },
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      "payment_success_email",
      expect.objectContaining({
        to: "buyer@example.com",
        orderNo: "order_1",
        amount: 25,
        currency: "usd",
      }),
      { dedupeKey: "payment_success_email:evt_checkout_email:order_1" }
    );
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      "slack_event",
      expect.objectContaining({ title: "Payment succeeded" }),
      { dedupeKey: "slack_event:evt_checkout_email:payment_succeeded" }
    );
  });

  it("skips side effects for duplicate completed events", async () => {
    mocks.claimStripeWebhookEvent.mockResolvedValue("completed");

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.handleCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.markStripeWebhookEventCompleted).not.toHaveBeenCalled();
  });

  it("asks Stripe to retry when the same event is already processing", async () => {
    mocks.claimStripeWebhookEvent.mockResolvedValue("processing");

    const res = await stripeWebhook(request());

    expect(res.status).toBe(409);
    expect(mocks.handleCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.markStripeWebhookEventCompleted).not.toHaveBeenCalled();
  });

  it("marks claimed events failed when handling throws", async () => {
    const error = new Error("checkout failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.handleCheckoutSession.mockRejectedValue(error);

    const res = await stripeWebhook(request());

    expect(res.status).toBe(500);
    expect(mocks.markStripeWebhookEventFailed).toHaveBeenCalledWith(
      "evt_checkout_1",
      error
    );
    consoleError.mockRestore();
  });
});
