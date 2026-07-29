/**
 * The billing portal must not silently mutate catalog subscriptions.
 *
 * Stripe portal configuration is Dashboard-owned mutable state. These tests
 * pin the fail-closed check that keeps quantity/product changes from charging a
 * customer while granting the fixed one-subscription credit amount.
 */
import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import { createSafeBillingPortalSession } from "@/services/stripe/portal";

function stripeWithConfiguration(subscriptionUpdatesEnabled: boolean) {
  const retrieve = vi.fn().mockResolvedValue({
    id: "bpc_safe",
    features: {
      subscription_update: { enabled: subscriptionUpdatesEnabled },
    },
  });
  const create = vi.fn().mockResolvedValue({
    id: "bps_1",
    url: "https://billing.stripe.test/session",
  });

  return {
    stripe: {
      billingPortal: {
        configurations: { retrieve },
        sessions: { create },
      },
    } as unknown as Stripe,
    retrieve,
    create,
  };
}

describe("safe Stripe billing portal", () => {
  it("uses the validated configuration for the created session", async () => {
    const { stripe, retrieve, create } = stripeWithConfiguration(false);

    const session = await createSafeBillingPortalSession(stripe, {
      customerId: "cus_1",
      returnUrl: "https://app.test/account/billing",
      configurationId: "bpc_safe",
    });

    expect(session.url).toBe("https://billing.stripe.test/session");
    expect(retrieve).toHaveBeenCalledWith("bpc_safe");
    expect(create).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://app.test/account/billing",
      configuration: "bpc_safe",
    });
  });

  it("fails closed when Dashboard configuration enables plan updates", async () => {
    const { stripe, create } = stripeWithConfiguration(true);

    await expect(
      createSafeBillingPortalSession(stripe, {
        customerId: "cus_1",
        returnUrl: "https://app.test/account/billing",
        configurationId: "bpc_unsafe",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_SESSION_FAILED" });
    expect(create).not.toHaveBeenCalled();
  });

  it("fails before calling Stripe when no configuration is provided", async () => {
    const { stripe, retrieve, create } = stripeWithConfiguration(false);

    await expect(
      createSafeBillingPortalSession(stripe, {
        customerId: "cus_1",
        returnUrl: "https://app.test/account/billing",
        configurationId: "",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_SESSION_FAILED" });
    expect(retrieve).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
