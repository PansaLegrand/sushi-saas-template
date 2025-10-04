import { Button } from "@/types/blocks/base/button";

export interface PricingGroup {
  name?: string;
  title?: string;
  description?: string;
  label?: string;
  is_featured?: boolean;
}

export interface PricingItem {
  title?: string;
  description?: string;
  label?: string;
  price?: string;
  original_price?: string;
  unit?: string;
  features_title?: string;
  features?: string[];
  button?: Button;
  tip?: string;
  is_featured?: boolean;
  interval: "month" | "year" | "one-time";
  product_id: string;
  product_name?: string;
  amount: number;
  cn_amount?: number;
  currency: string;
  credits?: number;
  valid_months?: number;
  group?: string;
  // Optional Stripe Price IDs for subscription checkout.
  // If provided, server checkout will reference these IDs instead of building price_data.
  price_id?: string;
  cn_price_id?: string;

  // Optional subscription promotions (demo-friendly).
  // - trial_days: adds a free trial period to the subscription (Checkout.subscription_data.trial_period_days)
  // - intro_price_cents + intro_months: apply an intro price for the first N months.
  //   Currently implemented via a one-time coupon equal to (amount - intro_price_cents).
  trial_days?: number;
  intro_price_cents?: number;
  intro_months?: number;
}

export interface Pricing {
  disabled?: boolean;
  name?: string;
  title?: string;
  description?: string;
  items?: PricingItem[];
  groups?: PricingGroup[];
}
