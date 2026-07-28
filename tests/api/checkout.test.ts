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
 * - Product: `max-monthly` (amount 7900 USD, interval month)
 * - User: email user@test.dev
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetRateLimitForTests } from "@/lib/rate-limit";

// Mocks first
vi.mock("@/services/user", () => ({ getUserUuid: vi.fn().mockResolvedValue("u-test") }));

const mocks = vi.hoisted(() => ({
  can: vi.fn(() => true),
  findPurchasableBillingProduct: vi.fn(),
  stripeCreate: vi.fn(),
}));

// The routes resolve their tenant through `getOrgContext`, which pulls in the
// real Better Auth instance (and therefore a real database) if left unmocked.
vi.mock("@/services/authz", () => ({
  getOrgContext: vi
    .fn()
    .mockResolvedValue({
      userId: "id-test",
      userUuid: "u-test",
      orgId: "id-org-test",
      orgUuid: "org-test",
      orgSlug: "test-org",
      role: "owner",
    }),
  getOrgContextFromHeaders: vi
    .fn()
    .mockResolvedValue({
      userId: "id-test",
      userUuid: "u-test",
      orgId: "id-org-test",
      orgUuid: "org-test",
      orgSlug: "test-org",
      role: "owner",
    }),
  can: mocks.can,
}));

vi.mock("@/models/user", () => ({ findUserByUuid: vi.fn().mockResolvedValue({ email: "user@test.dev" }) }));
vi.mock("@/models/order", () => ({
  OrderStatus: { Created: "created" },
  insertOrder: vi.fn().mockResolvedValue(undefined),
  updateOrderSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/billing-catalog", () => ({
  findPurchasableBillingProduct: mocks.findPurchasableBillingProduct,
}));

vi.mock("@/integrations/stripe", () => ({
  newStripeClient: () => ({
    stripe: () => ({ checkout: { sessions: { create: mocks.stripeCreate } } }),
  }),
}));

// Route after mocks
import { POST as checkout } from "@/app/api/checkout/route";

describe("POST /api/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitForTests();
    mocks.findPurchasableBillingProduct.mockReturnValue({
      product: {
        id: "max-monthly",
        legacyIds: ["scale-monthly"],
        name: "Max Monthly",
        tier: "max",
        interval: "month",
        validMonths: 1,
        credits: 2_500,
        prices: {},
      },
      price: {
        currency: "usd",
        amount: 7_900,
        stripePriceIds: ["price_1MaxMonth"],
      },
      stripePriceId: "price_1MaxMonth",
    });
    mocks.stripeCreate.mockResolvedValue({
      id: "cs_1",
      url: "https://stripe.test/cs",
    });
  });

  it("creates a session and returns checkout_url", async () => {
    const body = { product_id: "max-monthly", currency: "usd", locale: "en" };
    const req = new Request("http://local/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const res = await checkout(req);
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.code).toBe(0);
    expect(payload.data.checkout_url).toContain("https://");
    const orderMod = await import("@/models/order");
    expect(orderMod.insertOrder).toHaveBeenCalledTimes(1);
    expect(orderMod.updateOrderSession).toHaveBeenCalledTimes(1);
    expect(mocks.stripeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_1MaxMonth", quantity: 1 }],
      }),
      expect.anything()
    );
    expect(
      mocks.stripeCreate.mock.calls[0]?.[0]?.line_items?.[0]
    ).not.toHaveProperty("price_data");
  });

  it("rejects cross-site browser requests before side effects", async () => {
    const body = { product_id: "max-monthly", currency: "usd", locale: "en" };
    const req = new Request("http://local/api/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify(body),
    });

    const res = await checkout(req);
    const payload = await res.json();
    const orderMod = await import("@/models/order");

    expect(res.status).toBe(403);
    expect(payload.message).toBe("invalid origin");
    expect(orderMod.insertOrder).not.toHaveBeenCalled();
    expect(orderMod.updateOrderSession).not.toHaveBeenCalled();
  });

  it("refuses a member and names who can upgrade instead", async () => {
    // The plan is billed to the owner, so a member must not be able to put a
    // subscription on the team. Its own code, not a bare forbidden: the useful
    // thing to tell someone who wants an upgrade is who can grant it.
    mocks.can.mockReturnValueOnce(false);

    const body = { product_id: "max-monthly", currency: "usd", locale: "en" };
    const req = new Request("http://local/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const res = await checkout(req);
    const payload = await res.json();
    const orders = await import("@/models/order");

    expect(res.status).toBe(403);
    expect(payload.error_code).toBe("BILLING_OWNER_ONLY");
    // Refused before any order row exists.
    expect(orders.insertOrder).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated checkout requests before creating an order", async () => {
    // No session means no organization to bill.
    const authz = await import("@/services/authz");
    vi.mocked(authz.getOrgContext).mockResolvedValueOnce(null);

    const body = { product_id: "max-monthly", currency: "usd", locale: "en" };
    const req = new Request("http://local/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const res = await checkout(req);
    const payload = await res.json();
    const orderMod = await import("@/models/order");

    expect(res.status).toBe(401);
    expect(payload.code).toBe(-2);
    expect(payload.message).toBe("no auth, please sign-in");
    expect(orderMod.insertOrder).not.toHaveBeenCalled();
    expect(orderMod.updateOrderSession).not.toHaveBeenCalled();
    expect(mocks.findPurchasableBillingProduct).not.toHaveBeenCalled();
  });

  it("rejects a subscription whose Stripe Price is not configured", async () => {
    mocks.findPurchasableBillingProduct.mockReturnValueOnce(undefined);

    const req = new Request("http://local/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product_id: "max-monthly",
        currency: "usd",
        locale: "en",
      }),
    });

    const res = await checkout(req);
    const payload = await res.json();
    const orderMod = await import("@/models/order");

    expect(res.status).toBe(400);
    expect(payload.error_code).toBe("ORDER_INVALID_PRODUCT");
    expect(orderMod.insertOrder).not.toHaveBeenCalled();
    expect(mocks.stripeCreate).not.toHaveBeenCalled();
  });
});
