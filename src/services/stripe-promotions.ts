import Stripe from "stripe";
import { newStripeClient } from "@/integrations/stripe";

// Simple in-memory cache per runtime for created coupons, keyed by currency+amountOff.
const couponCache = new Map<string, string>();

function keyFor(currency: string, amountOff: number): string {
  return `${currency.toLowerCase()}:${amountOff}`;
}

async function getOrCreateOnceAmountOffCoupon(params: {
  currency: string;
  amountOff: number; // minor units
  name?: string;
}): Promise<string | undefined> {
  const { currency, amountOff, name } = params;
  if (!Number.isFinite(amountOff) || amountOff <= 0) return undefined;

  const cacheKey = keyFor(currency, amountOff);
  const cached = couponCache.get(cacheKey);
  if (cached) return cached;

  try {
    const stripe = newStripeClient().stripe();
    // Create a one-time, fixed amount-off coupon.
    const coupon = await stripe.coupons.create({
      currency: currency.toLowerCase() as any,
      amount_off: amountOff,
      duration: "once",
      name: name ?? `Intro ${currency.toUpperCase()} ${(amountOff / 100).toFixed(2)} off first month`,
    } as Stripe.CouponCreateParams);
    couponCache.set(cacheKey, coupon.id);
    return coupon.id;
  } catch (e) {
    console.warn("failed to create intro coupon", e);
    return undefined;
  }
}

export async function buildIntroDiscounts(params: {
  currency: string;
  baseAmount: number; // minor units
  introAmount: number; // minor units
}): Promise<Stripe.Checkout.SessionCreateParams.Discount[] | undefined> {
  const { currency, baseAmount, introAmount } = params;
  const diff = Math.max(0, baseAmount - introAmount);
  if (diff <= 0) return undefined;
  const couponId = await getOrCreateOnceAmountOffCoupon({
    currency,
    amountOff: diff,
    name: `Intro first month ${(introAmount / 100).toFixed(2)} then ${(baseAmount / 100).toFixed(2)} ${currency.toUpperCase()}`,
  });
  if (!couponId) return undefined;
  return [{ coupon: couponId }];
}

