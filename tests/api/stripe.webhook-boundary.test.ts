/**
 * The Stripe webhook's trust boundary must verify the exact request bytes. If
 * this test disappeared, a mocked SDK could let an unsigned payment event reach
 * fulfillment while every policy-level webhook test still passed.
 */
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCacheForTests } from "@/lib/env";

const mocks = vi.hoisted(() => ({
  processStripeWebhookEvent:
    vi.fn<
      typeof import("@/services/stripe/webhook").processStripeWebhookEvent
    >(),
}));

vi.mock("@/services/stripe/webhook", () => ({
  processStripeWebhookEvent: mocks.processStripeWebhookEvent,
}));

import { POST } from "@/app/api/pay/webhook/stripe/route";

const SIGNING_SECRET = "whsec_route_boundary_test";
const payload = JSON.stringify({
  id: "evt_boundary_1",
  object: "event",
  type: "checkout.session.completed",
  created: 1_767_225_600,
  livemode: false,
  data: { object: { id: "cs_boundary_1", object: "checkout.session" } },
});

describe("POST /api/pay/webhook/stripe trust boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SIGNING_SECRET);
    resetEnvCacheForTests();
    mocks.processStripeWebhookEvent.mockResolvedValue({
      status: 200,
      body: "ok",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCacheForTests();
  });

  it("passes a genuinely signed event and its unchanged raw body to the service", async () => {
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SIGNING_SECRET,
    });

    const response = await POST(requestWithSignature(signature));

    expect(response.status).toBe(200);
    expect(mocks.processStripeWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evt_boundary_1",
        type: "checkout.session.completed",
      }),
      payload,
    );
  });

  it("rejects an invalid signature before invoking payment policy", async () => {
    const response = await POST(requestWithSignature("invalid-signature"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error_code).toBe("PAYMENT_WEBHOOK_INVALID_SIGNATURE");
    expect(mocks.processStripeWebhookEvent).not.toHaveBeenCalled();
  });
});

function requestWithSignature(signature: string): Request {
  return new Request("http://test.local/api/pay/webhook/stripe", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
}
