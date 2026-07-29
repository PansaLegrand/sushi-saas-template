/**
 * Checkout fulfillment keeps Stripe's settled amount and provider identifiers.
 *
 * Without these assertions, a promotion could pay less than the catalog amount
 * while affiliate/reconciliation records the undiscounted value, and a later
 * one-time refund would have no durable PaymentIntent or Charge to match.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const mocks = vi.hoisted(() => ({
  findOrderByOrderNo:
    vi.fn<typeof import("@/models/order").findOrderByOrderNo>(),
  markOrderPaidWithGrant:
    vi.fn<typeof import("@/models/fulfillment").markOrderPaidWithGrant>(),
  updateAffiliateForOrder:
    vi.fn<typeof import("@/services/affiliate").updateAffiliateForOrder>(),
}));

vi.mock("@/models/order", () => ({
  findOrderByOrderNo: mocks.findOrderByOrderNo,
}));
vi.mock("@/models/fulfillment", () => ({
  markOrderPaidWithGrant: mocks.markOrderPaidWithGrant,
}));
vi.mock("@/services/affiliate", () => ({
  updateAffiliateForOrder: mocks.updateAffiliateForOrder,
}));

import { handleCheckoutSession } from "@/services/stripe/checkout-session";

function order(amount = 10_000) {
  return {
    id: 1,
    order_no: "order_checkout_1",
    created_at: new Date(),
    status: "created",
    user_uuid: "user_1",
    user_email: "buyer@example.test",
    amount,
    interval: "one-time",
    expired_at: null,
    stripe_session_id: "cs_1",
    stripe_payment_intent_id: null,
    stripe_charge_id: null,
    stripe_price_id: "price_plus_pack",
    credits: 500,
    currency: "usd",
    sub_id: null,
    sub_interval_count: null,
    sub_cycle_anchor: null,
    sub_period_end: null,
    sub_period_start: null,
    sub_times: null,
    product_id: "plus-pack",
    product_name: "Plus Pack",
    valid_months: 12,
    order_detail: null,
    paid_at: null,
    paid_email: null,
    paid_detail: null,
    checkout_intent_id: "intent_1",
    checkout_fingerprint: "fingerprint_1",
    checkout_locale: "en",
    org_uuid: "org_1",
  };
}

function session(
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Checkout.Session {
  return {
    id: "cs_1",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    payment_intent: "pi_1",
    amount_total: 7_500,
    currency: "usd",
    customer_details: { email: "buyer@example.test" },
    metadata: { order_no: "order_checkout_1" },
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

describe("Stripe checkout fulfillment receipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const settled = order(7_500);
    mocks.findOrderByOrderNo.mockResolvedValue(order());
    mocks.markOrderPaidWithGrant.mockResolvedValue({
      order: settled,
      credit_granted: true,
    });
    mocks.updateAffiliateForOrder.mockResolvedValue(undefined);
  });

  it("persists the settled amount and expanded charge before computing rewards", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      id: "pi_1",
      latest_charge: { id: "ch_1" },
    });
    const stripe = {
      paymentIntents: { retrieve },
    } as unknown as Stripe;

    await handleCheckoutSession(stripe, session());

    expect(retrieve).toHaveBeenCalledWith("pi_1");
    expect(mocks.markOrderPaidWithGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        order_no: "order_checkout_1",
        amount_paid: 7_500,
        currency: "usd",
        stripe_payment_intent_id: "pi_1",
        stripe_charge_id: "ch_1",
      }),
    );
    const fulfillment = mocks.markOrderPaidWithGrant.mock.calls[0]?.[0];
    expect(JSON.parse(fulfillment?.paid_detail ?? "{}")).toMatchObject({
      checkout_session_id: "cs_1",
      payment_intent_id: "pi_1",
      charge_id: "ch_1",
      amount_total: 7_500,
    });
    expect(mocks.updateAffiliateForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ order_no: "order_checkout_1", amount: 7_500 }),
    );
  });

  it("refuses a Stripe currency that differs from the local order", async () => {
    const stripe = {
      paymentIntents: {
        retrieve: vi.fn().mockResolvedValue({
          id: "pi_1",
          latest_charge: "ch_1",
        }),
      },
    } as unknown as Stripe;

    await expect(
      handleCheckoutSession(stripe, session({ currency: "cny" })),
    ).rejects.toMatchObject({ code: "ORDER_INVALID_PRODUCT" });
    expect(mocks.markOrderPaidWithGrant).not.toHaveBeenCalled();
    expect(mocks.updateAffiliateForOrder).not.toHaveBeenCalled();
  });
});
