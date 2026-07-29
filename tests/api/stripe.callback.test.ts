import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveStripeCheckoutReturn: vi.fn(),
}));

vi.mock("@/services/checkout", () => ({
  resolveStripeCheckoutReturn: mocks.resolveStripeCheckoutReturn,
}));

import { GET } from "@/app/api/pay/callback/stripe/route";

describe("GET /api/pay/callback/stripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveStripeCheckoutReturn.mockResolvedValue({
      status: "processing",
      locale: "en",
    });
  });

  it("redirects a verified but not-yet-fulfilled payment as processing", async () => {
    const response = await GET(
      new Request(
        "http://localhost:3000/api/pay/callback/stripe?session_id=cs_1&order_no=order-1&locale=fr",
      ),
    );

    expect(response.status).toBe(303);
    expect(
      new URL(response.headers.get("location")!).searchParams.get("checkout"),
    ).toBe("processing");
    expect(mocks.resolveStripeCheckoutReturn).toHaveBeenCalledWith({
      sessionId: "cs_1",
      orderNo: "order-1",
    });
  });

  it("redirects unverified parameters to the failure state", async () => {
    mocks.resolveStripeCheckoutReturn.mockRejectedValueOnce(
      new Error("Stripe unavailable"),
    );

    const response = await GET(
      new Request(
        "http://localhost:3000/api/pay/callback/stripe?session_id=cs_bad&order_no=order-bad",
      ),
    );

    expect(response.status).toBe(303);
    expect(
      new URL(response.headers.get("location")!).searchParams.get("checkout"),
    ).toBe("failed");
  });

  it("does not call Stripe without both opaque identifiers", async () => {
    const response = await GET(
      new Request(
        "http://localhost:3000/api/pay/callback/stripe?session_id=cs_1",
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("checkout=failed");
    expect(mocks.resolveStripeCheckoutReturn).not.toHaveBeenCalled();
  });
});
