import Stripe from "stripe";

class StripeClient {
  private static instance: StripeClient;
  private _stripe: Stripe;

  private constructor() {
    this._stripe = new Stripe(process.env.STRIPE_PRIVATE_KEY!, {
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
