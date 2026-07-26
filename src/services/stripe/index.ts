/**
 * Stripe business logic.
 *
 * The SDK client itself lives in `@/integrations/stripe` — that layer only
 * constructs external clients. Everything here is our own logic that happens to
 * talk to Stripe: fulfilling a paid checkout, resolving a customer id, building
 * promotional discounts.
 */
export { handleCheckoutSession } from "./checkout-session";
export { getOrCreateCustomerIdForOrg } from "./customer";
export {
  orderPayTransNo,
  renewalOrderNo,
  subscriptionPeriodTransNo,
} from "./idempotency";
export { buildIntroDiscounts } from "./promotions";
