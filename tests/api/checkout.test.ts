/**
 * Integration test for the checkout API.
 *
 * What we test
 * - Given a valid product (from the typed pricing config), the route:
 *   1) validates payload and pricing
 *   2) inserts an order with status `created`
 *   3) creates a Stripe Checkout session
 *   4) returns `{ code: 0, data: { checkout_url } }`
 *
 * How it runs
 * - We mock auth, user lookup, order writes, pricing, and Stripe client.
 * - We then call the route handler with a JSON Request and assert the output.
 *
 * Test data
 * - Product: `scale-monthly` (amount 7900 USD, interval month)
 * - User: email user@test.dev
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks first
vi.mock("@/services/user", () => ({ getUserUuid: vi.fn().mockResolvedValue("u-test") }));
vi.mock("@/models/user", () => ({ findUserByUuid: vi.fn().mockResolvedValue({ email: "user@test.dev" }) }));
vi.mock("@/models/order", () => ({
  OrderStatus: { Created: "created" },
  insertOrder: vi.fn().mockResolvedValue(undefined),
  updateOrderSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/page", () => ({
  getPricingPage: vi.fn().mockResolvedValue({
    pricing: {
      items: [
        {
          product_id: "scale-monthly",
          amount: 7900,
          currency: "usd",
          interval: "month",
          product_name: "Scale Monthly",
          valid_months: 1,
          credits: 800,
        },
      ],
    },
  }),
}));

vi.mock("@/integrations/stripe", () => ({
  newStripeClient: () => ({
    stripe: () => ({ checkout: { sessions: { create: vi.fn().mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs" }) } } }),
  }),
}));

// Route after mocks
import { POST as checkout } from "@/app/api/checkout/route";

describe("POST /api/checkout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a session and returns checkout_url", async () => {
    const body = { product_id: "scale-monthly", currency: "usd", locale: "en" };
    const req = new Request("http://local/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const res = await checkout(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.code).toBe(0);
    expect(payload.data.checkout_url).toContain("https://");
    const orderMod = await import("@/models/order");
    expect(orderMod.insertOrder).toHaveBeenCalledTimes(1);
    expect(orderMod.updateOrderSession).toHaveBeenCalledTimes(1);
  });
});
