/**
 * Route contract for checkout.
 *
 * If this file disappeared, authentication or owner authorization could drift
 * behind the money mutation, or the browser's purchase-intent key could stop
 * reaching the service without any HTTP-level test noticing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors/app-error";
import { resetRateLimitForTests } from "@/lib/rate-limit";
import { postJson } from "../helpers/request";

const mocks = vi.hoisted(() => ({
  getOrgContext:
    vi.fn<typeof import("@/services/authz").getOrgContext>(),
  can: vi.fn<typeof import("@/services/authz").can>(),
  createCheckoutSession:
    vi.fn<typeof import("@/services/checkout").createCheckoutSession>(),
}));

vi.mock("@/services/authz", () => ({
  getOrgContext: mocks.getOrgContext,
  can: mocks.can,
}));

vi.mock("@/services/checkout", () => ({
  createCheckoutSession: mocks.createCheckoutSession,
}));

import { POST as checkout } from "@/app/api/checkout/route";

const BODY = {
  product_id: "max-monthly",
  currency: "usd",
  locale: "en",
};
const INTENT_ID = "019faa72-2af9-7a53-9fd2-a88ccf0f47aa";

function request(
  body: unknown = BODY,
  headers: Record<string, string> = {}
) {
  return postJson("/api/checkout", body, {
    headers: {
      "Idempotency-Key": INTENT_ID,
      ...headers,
    },
  });
}

describe("POST /api/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.can.mockReturnValue(true);
    mocks.createCheckoutSession.mockResolvedValue({
      order_no: "order-1",
      session_id: "cs_1",
      checkout_url: "https://checkout.stripe.test/cs_1",
      reused: false,
    });
  });

  it("passes the purchase intent to the checkout service", async () => {
    const res = await checkout(request());
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.data.checkout_url).toBe(
      "https://checkout.stripe.test/cs_1"
    );
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        orgUuid: "org-test",
        userUuid: "u-test",
        productId: "max-monthly",
        currency: "usd",
        locale: "en",
        checkoutIntentId: INTENT_ID,
      })
    );
  });

  it("rejects unauthenticated requests before checkout orchestration", async () => {
    mocks.getOrgContext.mockResolvedValueOnce(null);

    const res = await checkout(request());

    expect(res.status).toBe(401);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.can).not.toHaveBeenCalled();
  });

  it("rejects non-owners before checkout orchestration", async () => {
    mocks.can.mockReturnValueOnce(false);

    const res = await checkout(request());
    const payload = await res.json();

    expect(res.status).toBe(403);
    expect(payload.error_code).toBe("BILLING_OWNER_ONLY");
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("requires an Idempotency-Key after authentication", async () => {
    const req = postJson("/api/checkout", BODY);

    const res = await checkout(req);
    const payload = await res.json();

    expect(res.status).toBe(400);
    expect(payload.error_code).toBe("REQUEST_MISSING_FIELD");
    expect(payload.details).toEqual({ field: "Idempotency-Key" });
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects cross-site requests before authentication and checkout", async () => {
    const res = await checkout(
      request(BODY, { origin: "https://evil.example" })
    );

    expect(res.status).toBe(403);
    expect(mocks.getOrgContext).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns a catalogued conflict when one intent changes terms", async () => {
    mocks.createCheckoutSession.mockRejectedValueOnce(
      new AppError("CHECKOUT_INTENT_CONFLICT")
    );

    const res = await checkout(request());
    const payload = await res.json();

    expect(res.status).toBe(409);
    expect(payload.error_code).toBe("CHECKOUT_INTENT_CONFLICT");
  });
});
