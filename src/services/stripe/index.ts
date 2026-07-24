/**
 * Stripe business logic.
 *
 * The SDK client itself lives in `@/integrations/stripe` — that layer only
 * constructs external clients. Everything here is our own logic that happens to
 * talk to Stripe: fulfilling a paid checkout, resolving a customer id, building
 * promotional discounts.
 */
export { handleCheckoutSession } from "./checkout-session";
export { getOrCreateCustomerIdForUser } from "./customer";
export { buildIntroDiscounts } from "./promotions";
