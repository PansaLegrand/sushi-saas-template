import { z } from "zod";

import { can, getOrgContext } from "@/services/authz";
import { insertOrder, OrderStatus, updateOrderSession } from "@/models/order";
import { respData, respNoAuth } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { parseJsonBody } from "@/lib/http/request";

import Stripe from "stripe";
import { findOrganizationByUuid } from "@/models/organization";
import { findUserByUuid } from "@/models/user";
import { newId } from "@/lib/ids";
import { newStripeClient } from "@/integrations/stripe";
import { Order } from "@/types/order";
import { getAppEnv } from "@/lib/env";
import { requireSameOrigin } from "@/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { getOrCreateCustomerIdForOrg } from "@/services/stripe";
import { findPurchasableBillingProduct } from "@/services/billing-catalog";
import { absoluteLocaleUrl } from "@/i18n/locale";
import { logger as baseLogger, requestIdFromHeaders } from "@/lib/logger/server";

const CheckoutSchema = z.object({
  product_id: z.string().trim().optional(),
  currency: z.enum(["usd", "cny"]).optional(),
  locale: z.string().trim().optional(),
});

export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "checkout");
  if (limited) return limited;

  try {
    const request_id = requestIdFromHeaders(req.headers);
    const log = baseLogger.child({ request_id, route: "/api/checkout" });
    const start = Date.now();
    const body = await parseJsonBody(req, CheckoutSchema);
    const product_id = body.product_id;
    const requestedCurrency = body.currency ?? "usd";
    const locale = body.locale || "en";

    const env = getAppEnv();
    let cancel_url = `${env.NEXT_PUBLIC_PAY_CANCEL_URL || env.NEXT_PUBLIC_WEB_URL}`;
    if (cancel_url && cancel_url.startsWith("/")) {
      // relative url
      cancel_url = absoluteLocaleUrl(env.NEXT_PUBLIC_WEB_URL, locale, cancel_url);
    }
    if (!product_id) {
      return respCode("REQUEST_MISSING_FIELD", {
        details: { field: "product_id" },
      });
    }

    // get signed user
    const ctx = await getOrgContext(req);
    if (!ctx) {
      return respNoAuth("no auth, please sign-in");
    }

    // The plan is bought by the organization and billed to its owner, so a
    // member cannot put a subscription on the team. Reported with its own code
    // rather than a bare forbidden: the useful thing to tell someone who wants
    // an upgrade is who can grant it.
    if (!can(ctx, "billing:manage")) {
      return respCode("BILLING_OWNER_ONLY");
    }

    // Resolve every commercial term on the server from the canonical catalog.
    // A subscription without a stable Stripe Price cannot later be mapped to a
    // tier or renewal grant, so there is deliberately no inline-price fallback.
    const selection = findPurchasableBillingProduct(
      product_id,
      requestedCurrency
    );
    if (!selection) {
      return respCode("ORDER_INVALID_PRODUCT");
    }

    const { product, price, stripePriceId } = selection;
    const {
      id: canonicalProductId,
      name: product_name,
      interval,
      validMonths: valid_months,
      credits,
    } = product;
    const { amount, currency } = price;
    const is_subscription = interval === "month" || interval === "year";

    const user = await findUserByUuid(ctx.userUuid);
    const user_email = user?.email;
    if (!user_email) {
      return respCode("ACCOUNT_NOT_FOUND");
    }

    // generate order_no
    const order_no = newId();

    const currentDate = new Date();
    const created_at = currentDate.toISOString();

    // calculate expired_at
    let expired_at = "";
    if (valid_months && valid_months > 0) {
      const timePeriod = new Date(currentDate);
      timePeriod.setMonth(currentDate.getMonth() + valid_months);

      const timePeriodMillis = timePeriod.getTime();
      let delayTimeMillis = 0;

      // subscription
      if (is_subscription) {
        delayTimeMillis = 24 * 60 * 60 * 1000; // delay 24 hours expired
      }

      const newTimeMillis = timePeriodMillis + delayTimeMillis;
      const newDate = new Date(newTimeMillis);

      expired_at = newDate.toISOString();
    }

    // create order
    const order = {
      order_no: order_no,
      created_at: new Date(created_at),
      org_uuid: ctx.orgUuid,
      user_uuid: ctx.userUuid,
      user_email: user_email,
      amount: amount,
      interval: interval,
      expired_at: expired_at ? new Date(expired_at) : null,
      status: OrderStatus.Created,
      credits: credits || 0,
      currency: currency,
      product_id: canonicalProductId,
      product_name: product_name,
      valid_months: valid_months,
    };
    await insertOrder(order);

    // checkout with stripe
    const result = await stripeCheckout({
      order: order as any,
      locale,
      cancel_url,
      priceId: stripePriceId,
      request_id,
    });

    log.info({
      event: "checkout.session.created",
      order_no,
      user_id: ctx.userUuid,
      product_id: canonicalProductId,
      interval,
      currency,
      is_subscription: interval === "month" || interval === "year",
      duration_ms: Date.now() - start,
    });
    return respData(result);
  } catch (e) {
    // Never interpolate e.message into the response: on this path it can carry
    // Stripe API payloads and Drizzle query text. respError logs the real thing
    // and sends only the catalog's public message.
    return respError(e, {
      log: baseLogger,
      logFields: { event: "checkout.error" },
      fallback: "PAYMENT_SESSION_FAILED",
    });
  }
}

async function stripeCheckout({
  order,
  locale,
  cancel_url,
  priceId,
  request_id,
}: {
  order: Order;
  locale: string;
  cancel_url: string;
  priceId: string;
  request_id?: string;
}) {
  const log = baseLogger.child({ request_id, route: "/api/checkout" });
  const intervals = ["month", "year"];
  const is_subscription = intervals.includes(order.interval);

  const client = newStripeClient();

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price: priceId,
      quantity: 1,
    },
  ];

  let options: Stripe.Checkout.SessionCreateParams = {
    payment_method_types: ["card"],
    line_items: lineItems,
    allow_promotion_codes: true,
    client_reference_id: order.order_no,
    metadata: {
      project: getAppEnv().NEXT_PUBLIC_PROJECT_NAME,
      product_name: order.product_name || "",
      order_no: order.order_no,
      user_email: order.user_email,
      credits: order.credits,
      user_uuid: order.user_uuid,
      // Stamped so subscription webhooks attribute the plan to the right
      // tenant without falling back to a guess.
      org_uuid: order.org_uuid ?? "",
    },
    mode: is_subscription ? "subscription" : "payment",
    success_url: `${getAppEnv().NEXT_PUBLIC_WEB_URL}/api/pay/callback/stripe?locale=${locale}&session_id={CHECKOUT_SESSION_ID}&order_no=${order.order_no}`,
    cancel_url: cancel_url,
    billing_address_collection: "auto",
    customer_update: { address: "auto", name: "auto" },
    expand: ["subscription", "payment_intent"],
  };

  // Bind to the organization's Stripe Customer. Two checkouts by two different
  // members of the same team must land on one customer, or the team ends up
  // with two payment methods and two portals showing half the picture each.
  try {
    const org = order.org_uuid
      ? await findOrganizationByUuid(order.org_uuid)
      : undefined;

    if (org && order.user_email) {
      const customerId = await getOrCreateCustomerIdForOrg({
        orgUuid: org.uuid,
        orgName: org.name,
        email: order.user_email,
        stripe_customer_id: org.stripe_customer_id,
      });
      if (customerId) {
        (options as any).customer = customerId;
      }
    }
  } catch (e) {
    // Fallback to email if customer resolution fails
    if (order.user_email) {
      options.customer_email = order.user_email;
    }
  }
  // If customer not set by the block above, set email as a fallback
  if (!(options as any).customer && order.user_email && !options.customer_email) {
    options.customer_email = order.user_email;
  }

  if (order.interval === "month" || order.interval === "year") {
    options.subscription_data = {
      metadata: options.metadata,
    };
  }

  if (order.currency === "cny" && !is_subscription) {
    options.payment_method_types = ["wechat_pay", "alipay", "card"];
    options.payment_method_options = {
      wechat_pay: {
        client: "web",
      },
      alipay: {},
    };
  }

  // For one-time payments, save the payment method for future off-session usage
  if (!is_subscription) {
    (options as any).payment_intent_data = {
      setup_future_usage: "off_session",
      metadata: options.metadata,
    } as Stripe.Checkout.SessionCreateParams.PaymentIntentData;
  }

  const session = await client
    .stripe()
    .checkout.sessions.create(options, { idempotencyKey: order.order_no });

  // update order detail
  await updateOrderSession(order.order_no, session.id, JSON.stringify(options));

  log.info({ event: "checkout.session.ready", order_no: order.order_no, session_id: session.id });
  return {
    order_no: order.order_no,
    session_id: session.id,
    checkout_url: session.url,
  };
}
