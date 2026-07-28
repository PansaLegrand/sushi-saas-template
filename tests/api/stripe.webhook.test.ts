import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  handleCheckoutSession: vi.fn(),
  enqueueJob: vi.fn(),
  claimStripeWebhookEvent: vi.fn(),
  markStripeWebhookEventCompleted: vi.fn(),
  markStripeWebhookEventFailed: vi.fn(),
  markStripeWebhookEventActionRequired: vi.fn(),
  isProductionRuntime: vi.fn(() => false),
  syncStripeSubscription: vi.fn(),
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
  markStripeWebhookEventActionRequired: mocks.markStripeWebhookEventActionRequired,
}));

vi.mock("@/services/subscriptions", () => ({
  syncStripeSubscription: mocks.syncStripeSubscription,
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
  isProductionRuntime: mocks.isProductionRuntime,
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
    mocks.isProductionRuntime.mockReturnValue(false);
    mocks.markStripeWebhookEventActionRequired.mockResolvedValue(undefined);
    mocks.syncStripeSubscription.mockResolvedValue({ status: "applied" });
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

  it("rejects a test-mode event in production without claiming it", async () => {
    // The signature has already verified at this point, so the failure being
    // guarded is a production deployment holding a test-mode webhook secret —
    // whose events would otherwise grant real credits from fixture amounts.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.isProductionRuntime.mockReturnValue(true);
    mocks.constructEvent.mockReturnValue({
      ...checkoutEvent("evt_test_mode"),
      livemode: false,
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(400);
    // Not claimed: the event never happened as far as this deployment goes, so
    // it must stay replayable after the secret is fixed.
    expect(mocks.claimStripeWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.handleCheckoutSession).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("rejects an event in production when livemode is absent", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.isProductionRuntime.mockReturnValue(true);
    mocks.constructEvent.mockReturnValue(checkoutEvent("evt_no_livemode"));

    const res = await stripeWebhook(request());

    expect(res.status).toBe(400);
    expect(mocks.handleCheckoutSession).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("processes a live-mode event in production", async () => {
    mocks.isProductionRuntime.mockReturnValue(true);
    mocks.constructEvent.mockReturnValue({
      ...checkoutEvent("evt_live_mode"),
      livemode: true,
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.handleCheckoutSession).toHaveBeenCalledTimes(1);
    expect(mocks.markStripeWebhookEventCompleted).toHaveBeenCalledWith("evt_live_mode");
  });

  it("accepts test-mode events outside production", async () => {
    // `stripe listen` forwards test-mode events to a developer's machine; the
    // guard must not make local development impossible.
    mocks.constructEvent.mockReturnValue({
      ...checkoutEvent("evt_local_test"),
      livemode: false,
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.handleCheckoutSession).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------------- action_required
  // A permanent condition is neither a success nor a retriable failure. The
  // distinction that matters to Stripe is the status code: 200 stops the retries,
  // 500 keeps them coming for three days over a condition that will not change.

  function subscriptionEvent(id: string) {
    return {
      id,
      type: "customer.subscription.updated",
      livemode: false,
      created: 1767225600,
      data: { object: { object: "subscription", id: "sub_1", customer: "cus_1" } },
    };
  }

  it("parks an unmapped subscription as action_required and stops the retries", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.constructEvent.mockReturnValue(subscriptionEvent("evt_unmapped"));
    mocks.syncStripeSubscription.mockResolvedValue({
      status: "unmapped",
      reason: "no-tier",
    });

    const res = await stripeWebhook(request());

    // 200, not 500: the price is missing from the catalog, and Stripe redelivering
    // for three days will not add it.
    expect(res.status).toBe(200);
    expect(mocks.markStripeWebhookEventActionRequired).toHaveBeenCalledWith(
      "evt_unmapped",
      expect.stringContaining("subscription_no-tier")
    );
    // Neither of the other two outcomes: not a success, not a retriable failure.
    expect(mocks.markStripeWebhookEventCompleted).not.toHaveBeenCalled();
    expect(mocks.markStripeWebhookEventFailed).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("records the identifiers an operator needs to act on", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.constructEvent.mockReturnValue(subscriptionEvent("evt_unmapped_detail"));
    mocks.syncStripeSubscription.mockResolvedValue({
      status: "unmapped",
      reason: "no-user",
    });

    await stripeWebhook(request());

    // The reason alone is not actionable — "no user" for *which* subscription.
    const [, reason] =
      mocks.markStripeWebhookEventActionRequired.mock.calls[0] ?? [];
    expect(reason).toContain("sub_1");
    expect(reason).toContain("cus_1");
    consoleError.mockRestore();
  });

  it("completes a subscription event that applied cleanly", async () => {
    mocks.constructEvent.mockReturnValue(subscriptionEvent("evt_applied"));
    mocks.syncStripeSubscription.mockResolvedValue({ status: "applied" });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.markStripeWebhookEventCompleted).toHaveBeenCalledWith("evt_applied");
    expect(mocks.markStripeWebhookEventActionRequired).not.toHaveBeenCalled();
  });

  it("parks a renewal on a price that is not in the plan catalog", async () => {
    // The regression this status was added for, and it was never a skip: `plan`
    // was resolved and never checked, so `credits` fell through to `?? 0`. The
    // renewal recorded a paid order granting nothing, took the product name from
    // the Stripe price nickname so it looked plausible, and completed the event.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.constructEvent.mockReturnValue({
      id: "evt_renewal_unmapped",
      type: "invoice.payment_succeeded",
      livemode: false,
      created: 1767225600,
      data: {
        object: {
          object: "invoice",
          id: "in_1",
          billing_reason: "subscription_cycle",
          subscription: "sub_1",
          customer: "cus_1",
          amount_paid: 2900,
          currency: "usd",
          lines: {
            data: [
              {
                period: { start: 1767225600, end: 1769904000 },
                // Not in src/config/pricing.ts under any locale.
                price: { id: "price_not_in_catalog", nickname: "Looks Legitimate" },
              },
            ],
          },
        },
      },
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.markStripeWebhookEventActionRequired).toHaveBeenCalledWith(
      "evt_renewal_unmapped",
      expect.stringContaining("unmapped_price")
    );
    // The price is what someone has to go and map, so it has to be in the row.
    const [, reason] =
      mocks.markStripeWebhookEventActionRequired.mock.calls[0] ?? [];
    expect(reason).toContain("price_not_in_catalog");
    expect(mocks.markStripeWebhookEventCompleted).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("completes a stale subscription event rather than parking it", async () => {
    // A stale event is an ordering artifact, not a problem: newer state already
    // won. Parking it would fill the queue with rows needing no action.
    mocks.constructEvent.mockReturnValue(subscriptionEvent("evt_stale"));
    mocks.syncStripeSubscription.mockResolvedValue({ status: "stale" });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.markStripeWebhookEventCompleted).toHaveBeenCalledWith("evt_stale");
    expect(mocks.markStripeWebhookEventActionRequired).not.toHaveBeenCalled();
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
