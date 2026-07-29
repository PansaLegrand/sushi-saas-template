/**
 * Checkout orchestration and replay guarantees.
 *
 * Without this file, a refactor could generate a fresh order number before
 * resolving the browser's purchase intent, turning a double-click or uncertain
 * network retry into two independently payable Stripe subscriptions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderRow } from "@/models/order";
import type { PurchasableBillingProduct } from "@/services/billing-catalog";

const mocks = vi.hoisted(() => ({
  insertOrderForCheckoutIntent:
    vi.fn<typeof import("@/models/order").insertOrderForCheckoutIntent>(),
  findOrderByCheckoutIntent:
    vi.fn<typeof import("@/models/order").findOrderByCheckoutIntent>(),
  findOrderByOrderNo:
    vi.fn<typeof import("@/models/order").findOrderByOrderNo>(),
  updateOrderSession:
    vi.fn<typeof import("@/models/order").updateOrderSession>(),
  findUserByUuid: vi.fn<typeof import("@/models/user").findUserByUuid>(),
  findOrganizationByUuid:
    vi.fn<typeof import("@/models/organization").findOrganizationByUuid>(),
  findPurchasableBillingProduct:
    vi.fn<
      typeof import("@/services/billing-catalog").findPurchasableBillingProduct
    >(),
  getOrCreateCustomerIdForOrg:
    vi.fn<typeof import("@/services/stripe").getOrCreateCustomerIdForOrg>(),
  stripeCreate: vi.fn(),
  stripeRetrieve: vi.fn(),
}));

vi.mock("@/models/order", () => ({
  OrderStatus: {
    Created: "created",
    Paid: "paid",
    Deleted: "deleted",
  },
  insertOrderForCheckoutIntent: mocks.insertOrderForCheckoutIntent,
  findOrderByCheckoutIntent: mocks.findOrderByCheckoutIntent,
  findOrderByOrderNo: mocks.findOrderByOrderNo,
  updateOrderSession: mocks.updateOrderSession,
}));

vi.mock("@/models/user", () => ({
  findUserByUuid: mocks.findUserByUuid,
}));

vi.mock("@/models/organization", () => ({
  findOrganizationByUuid: mocks.findOrganizationByUuid,
}));

vi.mock("@/services/billing-catalog", () => ({
  findPurchasableBillingProduct: mocks.findPurchasableBillingProduct,
}));

vi.mock("@/services/stripe", () => ({
  getOrCreateCustomerIdForOrg: mocks.getOrCreateCustomerIdForOrg,
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
  createCheckoutSession,
  resolveStripeCheckoutReturn,
} from "@/services/checkout";

const INTENT_ID = "019faa72-2af9-7a53-9fd2-a88ccf0f47aa";

function order(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 1,
    order_no: "order-1",
    created_at: new Date("2026-07-29T00:00:00.000Z"),
    user_uuid: "user-1",
    user_email: "owner@example.test",
    amount: 7_900,
    interval: "month",
    expired_at: new Date("2026-08-30T00:00:00.000Z"),
    status: "created",
    stripe_session_id: null,
    stripe_payment_intent_id: null,
    stripe_charge_id: null,
    credits: 2_500,
    currency: "usd",
    sub_id: null,
    sub_interval_count: null,
    sub_cycle_anchor: null,
    sub_period_end: null,
    sub_period_start: null,
    sub_times: null,
    product_id: "max-monthly",
    product_name: "Max Monthly",
    valid_months: 1,
    order_detail: null,
    paid_at: null,
    paid_email: null,
    paid_detail: null,
    checkout_intent_id: INTENT_ID,
    checkout_fingerprint: "fingerprint",
    stripe_price_id: "price_1MaxMonth",
    checkout_locale: "en",
    org_uuid: "org-1",
    ...overrides,
  };
}

function selection(currency: "usd" | "cny" = "usd"): PurchasableBillingProduct {
  const isCny = currency === "cny";
  return {
    product: {
      id: "max-monthly",
      legacyIds: ["scale-monthly"],
      name: "Max Monthly",
      tier: "max" as const,
      interval: "month" as const,
      validMonths: 1,
      credits: 2_500,
      prices: {},
    },
    price: {
      currency,
      amount: isCny ? 54_900 : 7_900,
      stripePriceIds: [isCny ? "price_1MaxMonthCny" : "price_1MaxMonth"],
    },
    stripePriceId: isCny ? "price_1MaxMonthCny" : "price_1MaxMonth",
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    orgUuid: "org-1",
    userUuid: "user-1",
    productId: "max-monthly",
    currency: "usd" as const,
    locale: "en",
    checkoutIntentId: INTENT_ID,
    ...overrides,
  };
}

describe("createCheckoutSession", () => {
  let nextOrderId: number;
  let ordersByIntent: Map<string, OrderRow>;
  let stripeSessionsByKey: Map<
    string,
    { id: string; url: string; status: "open" }
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    nextOrderId = 1;
    ordersByIntent = new Map();
    stripeSessionsByKey = new Map();

    mocks.findUserByUuid.mockResolvedValue({
      id: "auth-user-1",
      uuid: "user-1",
      email: "owner@example.test",
    } as never);
    mocks.findOrganizationByUuid.mockResolvedValue({
      id: "auth-org-1",
      uuid: "org-1",
      name: "Example Org",
      slug: "example-org",
      stripe_customer_id: "cus_1",
    } as never);
    mocks.findOrderByOrderNo.mockResolvedValue(order());
    mocks.getOrCreateCustomerIdForOrg.mockResolvedValue("cus_1");
    mocks.findPurchasableBillingProduct.mockImplementation(
      (_productId, currency = "usd") => selection(currency),
    );

    mocks.insertOrderForCheckoutIntent.mockImplementation(async (data) => {
      const key = `${data.org_uuid}:${data.checkout_intent_id}`;
      if (ordersByIntent.has(key)) return undefined;

      const row = order({
        ...data,
        id: nextOrderId++,
      });
      ordersByIntent.set(key, row);
      return row;
    });
    mocks.findOrderByCheckoutIntent.mockImplementation(
      async (orgUuid, checkoutIntentId) =>
        ordersByIntent.get(`${orgUuid}:${checkoutIntentId}`),
    );
    mocks.updateOrderSession.mockImplementation(
      async (orderNo, sessionId, orderDetail) => {
        const entry = [...ordersByIntent.entries()].find(
          ([, value]) => value.order_no === orderNo,
        );
        if (!entry) {
          throw new Error(`missing test order: ${orderNo}`);
        }

        const updated = order({
          ...entry[1],
          stripe_session_id: sessionId,
          order_detail: orderDetail,
        });
        ordersByIntent.set(entry[0], updated);
        return updated;
      },
    );

    mocks.stripeCreate.mockImplementation(
      async (_options: unknown, requestOptions: { idempotencyKey: string }) => {
        const existing = stripeSessionsByKey.get(requestOptions.idempotencyKey);
        if (existing) return existing;

        const session = {
          id: `cs_${stripeSessionsByKey.size + 1}`,
          url: `https://checkout.stripe.test/cs_${
            stripeSessionsByKey.size + 1
          }`,
          status: "open" as const,
        };
        stripeSessionsByKey.set(requestOptions.idempotencyKey, session);
        return session;
      },
    );
    mocks.stripeRetrieve.mockImplementation(async (sessionId: string) => {
      return [...stripeSessionsByKey.values()].find(
        (session) => session.id === sessionId,
      );
    });
  });

  it("creates one order with a stable Stripe Price and intent snapshot", async () => {
    const result = await createCheckoutSession(input());

    expect(result.reused).toBe(false);
    expect(result.checkout_url).toBe("https://checkout.stripe.test/cs_1");
    expect(mocks.insertOrderForCheckoutIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        org_uuid: "org-1",
        checkout_intent_id: INTENT_ID,
        stripe_price_id: "price_1MaxMonth",
        checkout_locale: "en",
        product_id: "max-monthly",
        amount: 7_900,
      }),
    );
    expect(mocks.stripeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        line_items: [{ price: "price_1MaxMonth", quantity: 1 }],
      }),
      { idempotencyKey: result.order_no },
    );

    const storedReceipt = JSON.parse(
      mocks.updateOrderSession.mock.calls[0]?.[2] ?? "{}",
    );
    expect(storedReceipt).toEqual({
      schema_version: 1,
      mode: "subscription",
      stripe_price_id: "price_1MaxMonth",
      quantity: 1,
      currency: "usd",
    });
    expect(JSON.stringify(storedReceipt)).not.toContain("owner@example.test");
    expect(JSON.stringify(storedReceipt)).not.toContain("user-1");
    expect(JSON.stringify(storedReceipt)).not.toContain("org-1");
  });

  it("replays one intent as the existing order and Checkout Session", async () => {
    const first = await createCheckoutSession(input());
    const second = await createCheckoutSession(input());

    expect(second).toMatchObject({
      order_no: first.order_no,
      session_id: first.session_id,
      checkout_url: first.checkout_url,
      reused: true,
    });
    expect(ordersByIntent.size).toBe(1);
    expect(stripeSessionsByKey.size).toBe(1);
    expect(mocks.stripeCreate).toHaveBeenCalledTimes(1);
    expect(mocks.stripeRetrieve).toHaveBeenCalledWith(first.session_id);
  });

  it("collapses concurrent requests into one order and logical Stripe session", async () => {
    const [first, second] = await Promise.all([
      createCheckoutSession(input()),
      createCheckoutSession(input()),
    ]);

    expect(ordersByIntent.size).toBe(1);
    expect(stripeSessionsByKey.size).toBe(1);
    expect(first.order_no).toBe(second.order_no);
    expect(first.session_id).toBe(second.session_id);
    expect(
      new Set(
        mocks.stripeCreate.mock.calls.map((call) => call[1].idempotencyKey),
      ),
    ).toEqual(new Set([first.order_no]));
  });

  it("rejects the same intent key when its commercial terms change", async () => {
    await createCheckoutSession(input());

    await expect(
      createCheckoutSession(input({ currency: "cny" })),
    ).rejects.toMatchObject({
      code: "CHECKOUT_INTENT_CONFLICT",
      statusCode: 409,
    });

    expect(ordersByIntent.size).toBe(1);
    expect(stripeSessionsByKey.size).toBe(1);
  });

  it("allows two deliberate intents for the same organization", async () => {
    const [first, second] = await Promise.all([
      createCheckoutSession(input()),
      createCheckoutSession(
        input({
          checkoutIntentId: "019faa72-2af9-7a53-9fd2-a88ccf0f47ab",
        }),
      ),
    ]);

    expect(ordersByIntent.size).toBe(2);
    expect(stripeSessionsByKey.size).toBe(2);
    expect(first.order_no).not.toBe(second.order_no);
    expect(first.session_id).not.toBe(second.session_id);
  });

  it("repairs a failure after Stripe created the session", async () => {
    mocks.updateOrderSession.mockRejectedValueOnce(
      new Error("database unavailable after Stripe success"),
    );

    await expect(createCheckoutSession(input())).rejects.toThrow(
      "database unavailable",
    );

    const replay = await createCheckoutSession(input());
    const idempotencyKeys = mocks.stripeCreate.mock.calls.map(
      (call) => call[1].idempotencyKey,
    );

    expect(new Set(idempotencyKeys)).toEqual(new Set([replay.order_no]));
    expect(stripeSessionsByKey.size).toBe(1);
    expect(replay.session_id).toBe("cs_1");
    expect(replay.reused).toBe(true);
  });

  it("refuses to replace an expired session under the same intent", async () => {
    const first = await createCheckoutSession(input());
    mocks.stripeRetrieve.mockResolvedValueOnce({
      id: first.session_id,
      url: null,
      status: "expired",
    });

    await expect(createCheckoutSession(input())).rejects.toMatchObject({
      code: "PAYMENT_SESSION_EXPIRED",
      statusCode: 409,
    });

    expect(stripeSessionsByKey.size).toBe(1);
  });

  it("reports a complete but locally unfulfilled return as processing", async () => {
    mocks.findOrderByOrderNo.mockResolvedValue(
      order({ stripe_session_id: "cs_1" }),
    );
    mocks.stripeRetrieve.mockResolvedValueOnce({
      id: "cs_1",
      client_reference_id: "order-1",
      metadata: { order_no: "order-1" },
      status: "complete",
      payment_status: "unpaid",
    });

    await expect(
      resolveStripeCheckoutReturn({
        sessionId: "cs_1",
        orderNo: "order-1",
      }),
    ).resolves.toEqual({ status: "processing", locale: "en" });
  });

  it("reports success only after the local order is fulfilled", async () => {
    mocks.findOrderByOrderNo.mockResolvedValue(
      order({ stripe_session_id: "cs_1", status: "paid" }),
    );
    mocks.stripeRetrieve.mockResolvedValueOnce({
      id: "cs_1",
      client_reference_id: "order-1",
      status: "complete",
      payment_status: "paid",
    });

    await expect(
      resolveStripeCheckoutReturn({
        sessionId: "cs_1",
        orderNo: "order-1",
      }),
    ).resolves.toEqual({ status: "success", locale: "en" });
  });

  it("rejects a return whose session belongs to another order", async () => {
    mocks.findOrderByOrderNo.mockResolvedValue(
      order({ stripe_session_id: "cs_other" }),
    );

    await expect(
      resolveStripeCheckoutReturn({
        sessionId: "cs_1",
        orderNo: "order-1",
      }),
    ).rejects.toMatchObject({ code: "REQUEST_INVALID" });
    expect(mocks.stripeRetrieve).not.toHaveBeenCalled();
  });
});
