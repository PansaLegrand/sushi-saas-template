import Stripe from "stripe";
import { getRequiredEnv } from "@/lib/env";

// One client per runtime instance, reached through `newStripeClient()`. Every
// caller must go through it rather than constructing its own: a fresh
// `new Stripe()` per request builds its own HTTP agent, so it pays a TLS
// handshake Stripe's keep-alive would have reused, and it carries none of the
// options set below.
class StripeClient {
  private static instance: StripeClient;
  private _stripe: Stripe;

  private constructor() {
    this._stripe = new Stripe(getRequiredEnv("STRIPE_PRIVATE_KEY"), {
      // Identifies this template in Stripe's request logs and on the account's
      // integrations list, which is what makes a support thread about a failed
      // request traceable to the code that sent it.
      appInfo: {
        name: "sushi-saas-template",
        url: "https://www.sushi-templates.com",
      },
      // Pinned rather than changed: 2 is also the SDK default today. Stated
      // explicitly so an SDK upgrade that lowers the default cannot quietly
      // reduce it. Retries are safe on writes because the SDK attaches its own
      // idempotency key to each attempt, so a retried charge cannot double-bill.
      maxNetworkRetries: 2,
    });
  }

  public static getInstance(): StripeClient {
    if (!StripeClient.instance) {
      StripeClient.instance = new StripeClient();
    }
    return StripeClient.instance;
  }

  public stripe(): Stripe {
    return this._stripe;
  }
}

export function newStripeClient(): StripeClient {
  return StripeClient.getInstance();
}
