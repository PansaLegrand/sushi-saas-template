import {
  BILLING_PRODUCTS,
  type BillingCurrency,
  type BillingPrice,
  type BillingProduct,
} from "@/config/billing";

export type PurchasableBillingProduct = {
  product: BillingProduct;
  price: BillingPrice;
  stripePriceId: string;
};

function matchesProductId(
  product: BillingProduct,
  productId: string
): boolean {
  return product.id === productId || product.legacyIds.includes(productId);
}

/**
 * Resolve a browser selection to server-owned commercial terms.
 *
 * Missing Price IDs are not replaced with inline `price_data`: subscriptions
 * created that way cannot be mapped back to a tier or renewal credit grant.
 */
export function findPurchasableBillingProduct(
  productId: string,
  currency: BillingCurrency = "usd"
): PurchasableBillingProduct | undefined {
  const product = BILLING_PRODUCTS.find((candidate) =>
    matchesProductId(candidate, productId)
  );
  const price = product?.prices[currency];
  const stripePriceId = price?.stripePriceIds[0];

  if (!product || !price || !stripePriceId) return undefined;
  return { product, price, stripePriceId };
}

/** Resolve a Stripe renewal to the exact product and per-period credit grant. */
export function findBillingProductByPriceId(
  stripePriceId: string | null | undefined
): { product: BillingProduct; price: BillingPrice } | undefined {
  if (!stripePriceId) return undefined;

  for (const product of BILLING_PRODUCTS) {
    for (const price of Object.values(product.prices)) {
      if (price?.stripePriceIds.includes(stripePriceId)) {
        return { product, price };
      }
    }
  }

  return undefined;
}
