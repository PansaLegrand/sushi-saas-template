import type Stripe from "stripe";

import { AppError } from "@/lib/errors/app-error";

/**
 * Open a billing portal whose mutable features are explicitly constrained.
 *
 * Credit grants are catalog-based and intentionally treat each subscription as
 * one unit. Letting an operator later enable quantity or product changes in the
 * Stripe Dashboard would otherwise change money without changing that grant
 * rule. Retrieve the named configuration on every portal open and fail closed
 * if it has drifted.
 */
export async function createSafeBillingPortalSession(
  stripe: Stripe,
  input: {
    customerId: string;
    returnUrl: string;
    configurationId: string;
  },
): Promise<Stripe.BillingPortal.Session> {
  if (!input.configurationId) {
    throw new AppError("PAYMENT_SESSION_FAILED", {
      message: "Stripe billing portal configuration is not set",
    });
  }

  const configuration = await stripe.billingPortal.configurations.retrieve(
    input.configurationId,
  );

  if (configuration.features.subscription_update.enabled) {
    throw new AppError("PAYMENT_SESSION_FAILED", {
      message:
        "Stripe billing portal subscription updates must be disabled for catalog credit plans",
      details: { configuration_id: configuration.id },
    });
  }

  return stripe.billingPortal.sessions.create({
    customer: input.customerId,
    return_url: input.returnUrl,
    configuration: configuration.id,
  });
}
