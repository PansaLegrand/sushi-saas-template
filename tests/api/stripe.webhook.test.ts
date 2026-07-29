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
  findBillingProductByPriceId: vi.fn(),
  fulfillReservationCheckoutSession: vi.fn(),
  expireReservationCheckoutSession: vi.fn(),
  insertRenewalOrderWithGrant: vi.fn(),
  findSubscriptionByStripeId: vi.fn(),
  findOrganizationByStripeCustomerId: vi.fn(),
  findPersonalOrganizationByUserUuid: vi.fn(),
  findUserByStripeCustomerId: vi.fn(),
  getUserUuidsByEmail: vi.fn(),
  stripeSubscriptionRetrieve: vi.fn(),
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

vi.mock("@/services/reservations", () => ({
  fulfillReservationCheckoutSession: mocks.fulfillReservationCheckoutSession,
  expireReservationCheckoutSession: mocks.expireReservationCheckoutSession,
}));

vi.mock("@/services/jobs", () => ({
  enqueueJob: mocks.enqueueJob,
}));

vi.mock("@/models/stripe-webhook-event", () => ({
  claimStripeWebhookEvent: mocks.claimStripeWebhookEvent,
  markStripeWebhookEventCompleted: mocks.markStripeWebhookEventCompleted,
  markStripeWebhookEventFailed: mocks.markStripeWebhookEventFailed,
  markStripeWebhookEventActionRequired:
    mocks.markStripeWebhookEventActionRequired,
}));

vi.mock("@/services/subscriptions", () => ({
  syncStripeSubscription: mocks.syncStripeSubscription,
}));

vi.mock("@/services/billing-catalog", () => ({
  findBillingProductByPriceId: mocks.findBillingProductByPriceId,
}));

vi.mock("@/models/fulfillment", () => ({
  insertRenewalOrderWithGrant: mocks.insertRenewalOrderWithGrant,
}));

vi.mock("@/models/subscription", () => ({
  findSubscriptionByStripeId: mocks.findSubscriptionByStripeId,
}));

vi.mock("@/models/organization", () => ({
  findOrganizationByStripeCustomerId: mocks.findOrganizationByStripeCustomerId,
  findPersonalOrganizationByUserUuid: mocks.findPersonalOrganizationByUserUuid,
}));

vi.mock("@/models/user", () => ({
  findUserByStripeCustomerId: mocks.findUserByStripeCustomerId,
  getUserUuidsByEmail: mocks.getUserUuidsByEmail,
}));

vi.mock("@/integrations/stripe", () => ({
  newStripeClient: () => ({
    stripe: () => ({
      subscriptions: {
        retrieve: mocks.stripeSubscriptionRetrieve,
      },
    }),
  }),
}));

vi.mock("@/services/email/send", () => ({
  sendPaymentSuccessEmail: vi.fn().mockResolvedValue(undefined),
  sendPaymentFailedEmail: vi.fn().mockResolvedValue(undefined),
  sendReservationConfirmedEmail: vi.fn().mockResolvedValue(undefined),
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
    mocks.findBillingProductByPriceId.mockReturnValue(undefined);
    mocks.fulfillReservationCheckoutSession.mockResolvedValue(undefined);
    mocks.expireReservationCheckoutSession.mockResolvedValue(undefined);
    mocks.insertRenewalOrderWithGrant.mockResolvedValue({
      order: undefined,
      order_created: false,
      credit_granted: false,
    });
    mocks.findSubscriptionByStripeId.mockResolvedValue(undefined);
    mocks.findOrganizationByStripeCustomerId.mockResolvedValue(undefined);
    mocks.findPersonalOrganizationByUserUuid.mockResolvedValue(undefined);
    mocks.findUserByStripeCustomerId.mockResolvedValue(undefined);
    mocks.getUserUuidsByEmail.mockResolvedValue([]);
    mocks.stripeSubscriptionRetrieve.mockResolvedValue({
      id: "sub_1",
      customer: "cus_1",
      metadata: {},
    });
  });

  it("claims and completes a new Stripe event", async () => {
    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.claimStripeWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_checkout_1",
        eventType: "checkout.session.completed",
      }),
    );
    expect(mocks.handleCheckoutSession).toHaveBeenCalledTimes(1);
    expect(mocks.markStripeWebhookEventCompleted).toHaveBeenCalledWith(
      "evt_checkout_1",
    );
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
      { dedupeKey: "payment_success_email:evt_checkout_email:order_1" },
    );
    expect(mocks.enqueueJob).toHaveBeenCalledWith(
      "slack_event",
      expect.objectContaining({ title: "Payment succeeded" }),
      { dedupeKey: "slack_event:evt_checkout_email:payment_succeeded" },
    );
  });

  it("fulfills an existing reservation even when new reservations are disabled", async () => {
    mocks.constructEvent.mockReturnValue({
      ...checkoutEvent("evt_reservation_paid"),
      data: {
        object: {
          id: "cs_reservation",
          mode: "payment",
          payment_status: "paid",
          metadata: {
            type: "reservation",
            reservation_no: "reservation-1",
            order_no: "order-1",
          },
          customer_details: { email: "booker@example.test" },
          amount_total: 500,
          currency: "usd",
        },
      },
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.fulfillReservationCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cs_reservation" }),
    );
    expect(mocks.handleCheckoutSession).not.toHaveBeenCalled();
  });

  it("releases a reservation from its verified Stripe expiry event", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_reservation_expired",
      type: "checkout.session.expired",
      livemode: false,
      data: {
        object: {
          id: "cs_reservation",
          metadata: {
            type: "reservation",
            reservation_no: "reservation-1",
            order_no: "order-1",
          },
        },
      },
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.expireReservationCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cs_reservation" }),
    );
    expect(mocks.markStripeWebhookEventCompleted).toHaveBeenCalledWith(
      "evt_reservation_expired",
    );
  });

  it("does not fulfill a Checkout Session before payment settles", async () => {
    mocks.constructEvent.mockReturnValue({
      ...checkoutEvent("evt_checkout_unpaid"),
      data: {
        object: {
          id: "cs_unpaid",
          payment_status: "unpaid",
          metadata: { order_no: "order-1" },
          customer_details: null,
        },
      },
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.handleCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.fulfillReservationCheckoutSession).not.toHaveBeenCalled();
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
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
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
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
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
    expect(mocks.markStripeWebhookEventCompleted).toHaveBeenCalledWith(
      "evt_live_mode",
    );
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
      data: {
        object: { object: "subscription", id: "sub_1", customer: "cus_1" },
      },
    };
  }

  it("parks an unmapped subscription as action_required and stops the retries", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
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
      expect.stringContaining("subscription_no-tier"),
    );
    // Neither of the other two outcomes: not a success, not a retriable failure.
    expect(mocks.markStripeWebhookEventCompleted).not.toHaveBeenCalled();
    expect(mocks.markStripeWebhookEventFailed).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("records the identifiers an operator needs to act on", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.constructEvent.mockReturnValue(
      subscriptionEvent("evt_unmapped_detail"),
    );
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
    expect(mocks.markStripeWebhookEventCompleted).toHaveBeenCalledWith(
      "evt_applied",
    );
    expect(mocks.markStripeWebhookEventActionRequired).not.toHaveBeenCalled();
  });

  it("syncs Stripe's current subscription state instead of a tied stale payload", async () => {
    const delivered = subscriptionEvent("evt_tied_payload");
    (delivered.data.object as Record<string, unknown>).status = "canceled";
    mocks.constructEvent.mockReturnValue(delivered);
    mocks.stripeSubscriptionRetrieve.mockResolvedValue({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      metadata: {},
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.stripeSubscriptionRetrieve).toHaveBeenCalledWith("sub_1");
    expect(mocks.syncStripeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sub_1", status: "active" }),
      new Date(1767225600 * 1000),
    );
  });

  it("parks a renewal on a price that is not in the plan catalog", async () => {
    // The regression this status was added for, and it was never a skip: `plan`
    // was resolved and never checked, so `credits` fell through to `?? 0`. The
    // renewal recorded a paid order granting nothing, took the product name from
    // the Stripe price nickname so it looked plausible, and completed the event.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
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
                // Not in src/config/billing.ts.
                price: {
                  id: "price_not_in_catalog",
                  nickname: "Looks Legitimate",
                },
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
      expect.stringContaining("unmapped_price"),
    );
    // The price is what someone has to go and map, so it has to be in the row.
    const [, reason] =
      mocks.markStripeWebhookEventActionRequired.mock.calls[0] ?? [];
    expect(reason).toContain("price_not_in_catalog");
    expect(mocks.markStripeWebhookEventCompleted).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("parks a subscription-update invoice instead of granting catalog credits", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.constructEvent.mockReturnValue({
      id: "evt_subscription_update",
      type: "invoice.payment_succeeded",
      livemode: false,
      created: 1767225600,
      data: {
        object: {
          object: "invoice",
          id: "in_subscription_update",
          billing_reason: "subscription_update",
          subscription: "sub_update",
          lines: { data: [] },
        },
      },
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.markStripeWebhookEventActionRequired).toHaveBeenCalledWith(
      "evt_subscription_update",
      expect.stringContaining("renewal_unsupported_billing_reason"),
    );
    expect(mocks.insertRenewalOrderWithGrant).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("parks renewal quantities above one instead of under-granting credits", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.constructEvent.mockReturnValue({
      id: "evt_quantity_two",
      type: "invoice.payment_succeeded",
      livemode: false,
      created: 1767225600,
      data: {
        object: {
          object: "invoice",
          id: "in_quantity_two",
          billing_reason: "subscription_cycle",
          subscription: "sub_quantity_two",
          lines: {
            data: [
              {
                period: { start: 1767225600, end: 1769904000 },
                price: {
                  id: "price_plus",
                  recurring: { interval: "month" },
                },
                quantity: 2,
              },
            ],
          },
        },
      },
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.markStripeWebhookEventActionRequired).toHaveBeenCalledWith(
      "evt_quantity_two",
      expect.stringContaining("renewal_unsupported_quantity"),
    );
    expect(mocks.insertRenewalOrderWithGrant).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("parks a multi-item renewal instead of guessing which credit grant applies", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.constructEvent.mockReturnValue({
      id: "evt_multi_item",
      type: "invoice.payment_succeeded",
      livemode: false,
      created: 1767225600,
      data: {
        object: {
          object: "invoice",
          id: "in_multi_item",
          billing_reason: "subscription_cycle",
          subscription: "sub_multi_item",
          lines: {
            data: [
              {
                period: { start: 1767225600, end: 1769904000 },
                price: { id: "price_plus" },
                quantity: 1,
              },
              {
                period: { start: 1767225600, end: 1769904000 },
                price: { id: "price_max" },
                quantity: 1,
              },
            ],
          },
        },
      },
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.markStripeWebhookEventActionRequired).toHaveBeenCalledWith(
      "evt_multi_item",
      expect.stringContaining("renewal_ambiguous_subscription_lines"),
    );
    expect(mocks.insertRenewalOrderWithGrant).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("credits a renewal to the subscription's stored organization, not the payer's personal workspace", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_team_renewal",
      type: "invoice.payment_succeeded",
      livemode: false,
      created: 1767225600,
      data: {
        object: {
          object: "invoice",
          id: "in_team",
          billing_reason: "subscription_cycle",
          subscription: "sub_team",
          customer: "cus_team",
          customer_email: "payer@example.test",
          amount_paid: 2900,
          currency: "usd",
          lines: {
            data: [
              {
                period: { start: 1767225600, end: 1769904000 },
                price: {
                  id: "price_plus",
                  recurring: { interval: "month" },
                },
                quantity: 1,
              },
            ],
          },
        },
      },
    });
    mocks.findBillingProductByPriceId.mockReturnValue({
      product: {
        id: "plus-monthly",
        name: "Plus Monthly",
        credits: 500,
        validMonths: 1,
      },
    });
    mocks.findSubscriptionByStripeId.mockResolvedValue({
      org_uuid: "org-team",
      user_uuid: "user-payer",
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.insertRenewalOrderWithGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        order: expect.objectContaining({
          org_uuid: "org-team",
          user_uuid: "user-payer",
        }),
      }),
    );
    expect(mocks.findPersonalOrganizationByUserUuid).not.toHaveBeenCalled();
  });

  it("uses subscription metadata when the local subscription row is missing", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_metadata_renewal",
      type: "invoice.payment_succeeded",
      livemode: false,
      created: 1767225600,
      data: {
        object: {
          object: "invoice",
          id: "in_metadata",
          billing_reason: "subscription_cycle",
          subscription: "sub_metadata",
          customer: "cus_metadata",
          amount_paid: 7900,
          currency: "usd",
          lines: {
            data: [
              {
                period: { start: 1767225600, end: 1769904000 },
                price: {
                  id: "price_max",
                  recurring: { interval: "month" },
                },
                quantity: 1,
              },
            ],
          },
        },
      },
    });
    mocks.findBillingProductByPriceId.mockReturnValue({
      product: {
        id: "max-monthly",
        name: "Max Monthly",
        credits: 2500,
        validMonths: 1,
      },
    });
    mocks.stripeSubscriptionRetrieve.mockResolvedValue({
      id: "sub_metadata",
      customer: {
        id: "cus_metadata",
        email: "payer@example.test",
      },
      metadata: {
        org_uuid: "org-from-subscription",
        user_uuid: "user-from-subscription",
      },
    });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.insertRenewalOrderWithGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        order: expect.objectContaining({
          org_uuid: "org-from-subscription",
          user_uuid: "user-from-subscription",
        }),
      }),
    );
  });

  it("completes a stale subscription event rather than parking it", async () => {
    // A stale event is an ordering artifact, not a problem: newer state already
    // won. Parking it would fill the queue with rows needing no action.
    mocks.constructEvent.mockReturnValue(subscriptionEvent("evt_stale"));
    mocks.syncStripeSubscription.mockResolvedValue({ status: "stale" });

    const res = await stripeWebhook(request());

    expect(res.status).toBe(200);
    expect(mocks.markStripeWebhookEventCompleted).toHaveBeenCalledWith(
      "evt_stale",
    );
    expect(mocks.markStripeWebhookEventActionRequired).not.toHaveBeenCalled();
  });

  it("marks claimed events failed when handling throws", async () => {
    const error = new Error("checkout failed");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.handleCheckoutSession.mockRejectedValue(error);

    const res = await stripeWebhook(request());

    expect(res.status).toBe(500);
    expect(mocks.markStripeWebhookEventFailed).toHaveBeenCalledWith(
      "evt_checkout_1",
      error,
    );
    consoleError.mockRestore();
  });
});
