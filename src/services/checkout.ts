import { createHash } from "node:crypto";
import type Stripe from "stripe";

import { absoluteLocaleUrl, normalizeLocale } from "@/i18n/locale";
import { newStripeClient } from "@/integrations/stripe";
import { AppError } from "@/lib/errors/app-error";
import { getAppEnv } from "@/lib/env";
import { newId } from "@/lib/ids";
import { logger as baseLogger } from "@/lib/logger/server";
import {
  findOrderByCheckoutIntent,
  insertOrderForCheckoutIntent,
  OrderStatus,
  type OrderRow,
  updateOrderSession,
} from "@/models/order";
import { findOrganizationByUuid } from "@/models/organization";
import { findUserByUuid } from "@/models/user";
import { findPurchasableBillingProduct } from "@/services/billing-catalog";
import { getOrCreateCustomerIdForOrg } from "@/services/stripe";

const MAX_CHECKOUT_INTENT_ID_LENGTH = 255;

export type CheckoutResult = {
  order_no: string;
  session_id: string | null;
  checkout_url: string;
  /** True when this request resolved an earlier purchase intent. */
  reused: boolean;
};

type CreateCheckoutSessionInput = {
  orgUuid: string;
  userUuid: string;
  productId: string;
  currency: "usd" | "cny";
  locale?: string;
  checkoutIntentId: string;
  requestId?: string;
};

function checkoutFingerprint(input: {
  productId: string;
  stripePriceId: string;
  currency: string;
  locale: string;
}): string {
  // Version the serialized shape so adding another Stripe-affecting field later
  // cannot make an old key silently mean something new.
  return createHash("sha256")
    .update(
      JSON.stringify([
        "checkout-v1",
        input.productId,
        input.stripePriceId,
        input.currency,
        input.locale,
      ])
    )
    .digest("hex");
}

function orderExpiry(
  createdAt: Date,
  validMonths: number,
  isSubscription: boolean
): Date | null {
  if (validMonths <= 0) return null;

  const expiry = new Date(createdAt);
  expiry.setMonth(expiry.getMonth() + validMonths);
  if (isSubscription) {
    expiry.setTime(expiry.getTime() + 24 * 60 * 60 * 1000);
  }
  return expiry;
}

function appRedirectUrl(locale: string, configuredPath?: string): string {
  const env = getAppEnv();
  const target = configuredPath || "/";

  if (/^https?:\/\//i.test(target)) return target;
  return absoluteLocaleUrl(
    env.NEXT_PUBLIC_WEB_URL,
    locale,
    target.startsWith("/") ? target : `/${target}`
  );
}

function completedCheckoutUrl(locale: string): string {
  return appRedirectUrl(locale, getAppEnv().NEXT_PUBLIC_PAY_SUCCESS_URL);
}

function cancelCheckoutUrl(locale: string): string {
  const env = getAppEnv();
  return appRedirectUrl(
    locale,
    env.NEXT_PUBLIC_PAY_CANCEL_URL || env.NEXT_PUBLIC_WEB_URL
  );
}

function successCallbackUrl(
  locale: string,
  orderNo: string,
  sessionId: string
): string {
  const url = new URL("/api/pay/callback/stripe", getAppEnv().NEXT_PUBLIC_WEB_URL);
  url.searchParams.set("locale", locale);
  url.searchParams.set("session_id", sessionId);
  url.searchParams.set("order_no", orderNo);
  // Stripe replaces this literal token after payment. URLSearchParams encodes
  // braces, so restore only that known placeholder after safely encoding every
  // user/application value around it.
  return url
    .toString()
    .replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}");
}

function checkoutResultForExistingSession(
  order: OrderRow,
  session: Stripe.Checkout.Session,
  locale: string
): CheckoutResult {
  if (session.status === "expired") {
    throw new AppError("PAYMENT_SESSION_EXPIRED", {
      message: `checkout session ${session.id} expired for order ${order.order_no}`,
    });
  }

  if (session.status === "complete" || order.status === OrderStatus.Paid) {
    return {
      order_no: order.order_no,
      session_id: session.id,
      checkout_url: successCallbackUrl(locale, order.order_no, session.id),
      reused: true,
    };
  }

  if (!session.url) {
    throw new AppError("PAYMENT_SESSION_FAILED", {
      message: `checkout session ${session.id} has no redirect URL`,
    });
  }

  return {
    order_no: order.order_no,
    session_id: session.id,
    checkout_url: session.url,
    reused: true,
  };
}

function buildStripeOptions(input: {
  order: OrderRow;
  locale: string;
  priceId: string;
  customerId: string;
}): Stripe.Checkout.SessionCreateParams {
  const { order, locale, priceId, customerId } = input;
  const isSubscription =
    order.interval === "month" || order.interval === "year";
  const metadata = {
    project: getAppEnv().NEXT_PUBLIC_PROJECT_NAME,
    product_name: order.product_name || "",
    order_no: order.order_no,
    user_email: order.user_email,
    credits: order.credits,
    user_uuid: order.user_uuid,
    org_uuid: order.org_uuid,
  };

  const options: Stripe.Checkout.SessionCreateParams = {
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    client_reference_id: order.order_no,
    metadata,
    mode: isSubscription ? "subscription" : "payment",
    success_url: successCallbackUrl(locale, order.order_no, "{CHECKOUT_SESSION_ID}"),
    cancel_url: cancelCheckoutUrl(locale),
    billing_address_collection: "auto",
    customer: customerId,
    customer_update: { address: "auto", name: "auto" },
    expand: ["subscription", "payment_intent"],
  };

  if (isSubscription) {
    options.subscription_data = { metadata };
  } else {
    options.payment_intent_data = {
      setup_future_usage: "off_session",
      metadata,
    };
  }

  if (order.currency === "cny" && !isSubscription) {
    options.payment_method_types = ["wechat_pay", "alipay", "card"];
    options.payment_method_options = {
      wechat_pay: { client: "web" },
      alipay: {},
    };
  }

  return options;
}

/**
 * Start or resume one organization-scoped purchase intent.
 *
 * A new intent id deliberately creates a new order, even for the same product
 * and organization. This prevents retries and double-clicks without imposing a
 * one-subscription-per-organization policy: "buy another" is simply a new key.
 */
export async function createCheckoutSession(
  input: CreateCheckoutSessionInput
): Promise<CheckoutResult> {
  const checkoutIntentId = input.checkoutIntentId.trim();
  if (
    !checkoutIntentId ||
    checkoutIntentId.length > MAX_CHECKOUT_INTENT_ID_LENGTH
  ) {
    throw new AppError("REQUEST_INVALID", {
      message: `invalid checkout intent id length: ${checkoutIntentId.length}`,
      details: {
        field: "Idempotency-Key",
        max: MAX_CHECKOUT_INTENT_ID_LENGTH,
      },
    });
  }

  const locale = normalizeLocale(input.locale);
  const selection = findPurchasableBillingProduct(
    input.productId,
    input.currency
  );
  if (!selection) {
    throw new AppError("ORDER_INVALID_PRODUCT", {
      message: `checkout product is not purchasable: ${input.productId}:${input.currency}`,
    });
  }

  const { product, price, stripePriceId } = selection;
  const fingerprint = checkoutFingerprint({
    productId: product.id,
    stripePriceId,
    currency: price.currency,
    locale,
  });

  const [user, organization] = await Promise.all([
    findUserByUuid(input.userUuid),
    findOrganizationByUuid(input.orgUuid),
  ]);
  if (!user?.email) {
    throw new AppError("ACCOUNT_NOT_FOUND", {
      message: `checkout user not found: ${input.userUuid}`,
    });
  }
  if (!organization) {
    throw new AppError("RESOURCE_NOT_FOUND", {
      message: `checkout organization not found: ${input.orgUuid}`,
    });
  }

  const createdAt = new Date();
  const isSubscription =
    product.interval === "month" || product.interval === "year";
  let order = await insertOrderForCheckoutIntent({
    order_no: newId(),
    created_at: createdAt,
    org_uuid: input.orgUuid,
    user_uuid: input.userUuid,
    user_email: user.email,
    amount: price.amount,
    interval: product.interval,
    expired_at: orderExpiry(
      createdAt,
      product.validMonths,
      isSubscription
    ),
    status: OrderStatus.Created,
    credits: product.credits,
    currency: price.currency,
    product_id: product.id,
    product_name: product.name,
    valid_months: product.validMonths,
    checkout_intent_id: checkoutIntentId,
    checkout_fingerprint: fingerprint,
    stripe_price_id: stripePriceId,
    checkout_locale: locale,
  });
  const reused = !order;

  if (!order) {
    order = await findOrderByCheckoutIntent(
      input.orgUuid,
      checkoutIntentId
    );
  }
  if (!order) {
    throw new AppError("ORDER_CREATE_FAILED", {
      message: "checkout intent conflicted but its order could not be loaded",
    });
  }

  if (order.checkout_fingerprint !== fingerprint) {
    throw new AppError("CHECKOUT_INTENT_CONFLICT", {
      message:
        `checkout intent ${checkoutIntentId} was reused with different terms`,
      details: { field: "Idempotency-Key" },
    });
  }

  const stableLocale = order.checkout_locale || locale;
  if (order.status === OrderStatus.Paid) {
    return {
      order_no: order.order_no,
      session_id: order.stripe_session_id,
      checkout_url: completedCheckoutUrl(stableLocale),
      reused: true,
    };
  }

  const stripe = newStripeClient().stripe();
  if (order.stripe_session_id) {
    const session = await stripe.checkout.sessions.retrieve(
      order.stripe_session_id
    );
    return checkoutResultForExistingSession(order, session, stableLocale);
  }

  const stablePriceId = order.stripe_price_id;
  if (!stablePriceId) {
    throw new AppError("ORDER_CREATE_FAILED", {
      message: `checkout order ${order.order_no} has no Stripe Price`,
    });
  }

  const customerId = await getOrCreateCustomerIdForOrg({
    orgUuid: organization.uuid,
    orgName: organization.name,
    email: order.user_email,
    stripe_customer_id: organization.stripe_customer_id,
  });
  const options = buildStripeOptions({
    order,
    locale: stableLocale,
    priceId: stablePriceId,
    customerId,
  });
  const session = await stripe.checkout.sessions.create(options, {
    // Every replay resolves the same database row first, so it also reaches
    // Stripe with the same key. A crash after Stripe succeeds but before the
    // session id is persisted is therefore repairable by the next request.
    idempotencyKey: order.order_no,
  });

  const updated = await updateOrderSession(
    order.order_no,
    session.id,
    JSON.stringify(options)
  );
  if (!updated) {
    throw new AppError("ORDER_CREATE_FAILED", {
      message: `checkout order ${order.order_no} vanished before session update`,
    });
  }
  if (!session.url) {
    throw new AppError("PAYMENT_SESSION_FAILED", {
      message: `new checkout session ${session.id} has no redirect URL`,
    });
  }

  baseLogger.info({
    event: reused ? "checkout.session.recovered" : "checkout.session.created",
    request_id: input.requestId,
    order_no: order.order_no,
    user_id: order.user_uuid,
    org_id: order.org_uuid,
    product_id: order.product_id,
    interval: order.interval,
    currency: order.currency,
    is_subscription: isSubscription,
  });

  return {
    order_no: order.order_no,
    session_id: session.id,
    checkout_url: session.url,
    reused,
  };
}
