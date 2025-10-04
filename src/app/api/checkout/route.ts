import { getUserUuid } from "@/services/user";
import { insertOrder, OrderStatus, updateOrderSession } from "@/models/order";
import { respData, respErr } from "@/lib/resp";

import Stripe from "stripe";
import { findUserByUuid } from "@/models/user";
import { getSnowId } from "@/lib/hash";
import { getPricingPage } from "@/services/page";
import { PricingItem } from "@/types/blocks/pricing";
import { newStripeClient } from "@/integrations/stripe";
import { Order } from "@/types/order";
import { getOrCreateCustomerIdForUser } from "@/services/stripe-customer";
import { buildIntroDiscounts } from "@/services/stripe-promotions";

export async function POST(req: Request) {
  try {
    let { product_id, currency, locale } = await req.json();

    let cancel_url = `${
      process.env.NEXT_PUBLIC_PAY_CANCEL_URL || process.env.NEXT_PUBLIC_WEB_URL
    }`;
    if (cancel_url && cancel_url.startsWith("/")) {
      // relative url
      cancel_url = `${process.env.NEXT_PUBLIC_WEB_URL}/${locale}${cancel_url}`;
    }

    if (!product_id) {
      return respErr("invalid params");
    }

    // validate checkout params
    const page = await getPricingPage(locale);
    if (!page || !page.pricing || !page.pricing.items) {
      return respErr("invalid pricing table");
    }

    const item = page.pricing.items.find(
      (item: PricingItem) => item.product_id === product_id
    );

    if (!item || !item.amount || !item.interval || !item.currency) {
      return respErr("invalid checkout params");
    }

    let { amount, interval, valid_months, credits, product_name } = item;
    const trial_days = (item as any).trial_days as number | undefined;
    const intro_price_cents = (item as any).intro_price_cents as number | undefined;
    const intro_months = (item as any).intro_months as number | undefined;

    if (!["year", "month", "one-time"].includes(interval)) {
      return respErr("invalid interval");
    }

    if (interval === "year" && valid_months !== 12) {
      return respErr("invalid valid_months");
    }

    if (interval === "month" && valid_months !== 1) {
      return respErr("invalid valid_months");
    }

    if (currency === "cny") {
      if (!item.cn_amount) {
        return respErr("invalid checkout params: cn_amount");
      }
      amount = item.cn_amount;
    } else {
      currency = item.currency;
    }

    const is_subscription = interval === "month" || interval === "year";

    // Prefer using Stripe Price IDs for subscriptions when provided.
    // Choose price id by currency variant if present.
    const resolvedPriceId = is_subscription
      ? (currency === "cny" ? (item as any).cn_price_id : (item as any).price_id) || undefined
      : undefined;

    // get signed user
    const user_uuid = await getUserUuid(req);
    if (!user_uuid) {
      return respErr("no auth, please sign-in");
    }

    const user = await findUserByUuid(user_uuid);
    const user_email = user?.email;
    if (!user_email) {
      return respErr("invalid user");
    }

    // generate order_no
    const order_no = getSnowId();

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
      user_uuid: user_uuid,
      user_email: user_email,
      amount: amount,
      interval: interval,
      expired_at: expired_at ? new Date(expired_at) : null,
      status: OrderStatus.Created,
      credits: credits || 0,
      currency: currency,
      product_id: product_id,
      product_name: product_name,
      valid_months: valid_months,
    };
    await insertOrder(order);

    // checkout with stripe
    const result = await stripeCheckout({
      order: order as any,
      locale,
      cancel_url,
      priceId: resolvedPriceId,
      promo: {
        trial_days: trial_days && trial_days > 0 ? trial_days : undefined,
        intro_price_cents: intro_price_cents && intro_price_cents > 0 ? intro_price_cents : undefined,
        intro_months: intro_months && intro_months > 0 ? intro_months : undefined,
      },
    });

    return respData(result);
  } catch (e: any) {
    console.log("checkout failed: ", e);
    return respErr("checkout failed: " + e.message);
  }
}

async function stripeCheckout({
  order,
  locale,
  cancel_url,
  priceId,
  promo,
}: {
  order: Order;
  locale: string;
  cancel_url: string;
  priceId?: string;
  promo?: {
    trial_days?: number;
    intro_price_cents?: number;
    intro_months?: number;
  };
}) {
  const intervals = ["month", "year"];
  const is_subscription = intervals.includes(order.interval);

  const client = newStripeClient();

  // If a Price ID is provided (subscriptions), reference it directly.
  // Otherwise fall back to inline price_data.
  let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
  if (is_subscription && priceId) {
    lineItems = [
      {
        price: priceId,
        quantity: 1,
      },
    ];
  } else {
    lineItems = [
      {
        price_data: {
          currency: order.currency || "usd",
          product_data: {
            name: order.product_name || "",
          },
          unit_amount: order.amount,
          recurring: is_subscription
            ? {
                interval: order.interval as any,
              }
            : undefined,
        },
        quantity: 1,
      },
    ];
  }

  let options: Stripe.Checkout.SessionCreateParams = {
    payment_method_types: ["card"],
    line_items: lineItems,
    allow_promotion_codes: true,
    client_reference_id: order.order_no,
    metadata: {
      project: process.env.NEXT_PUBLIC_PROJECT_NAME || "",
      product_name: order.product_name || "",
      order_no: order.order_no,
      user_email: order.user_email,
      credits: order.credits,
      user_uuid: order.user_uuid,
    },
    mode: is_subscription ? "subscription" : "payment",
    success_url: `${process.env.NEXT_PUBLIC_WEB_URL}/api/pay/callback/stripe?locale=${locale}&session_id={CHECKOUT_SESSION_ID}&order_no=${order.order_no}`,
    cancel_url: cancel_url,
    billing_address_collection: "auto",
    customer_update: { address: "auto", name: "auto" },
    expand: ["subscription", "payment_intent"],
  };

  // Prefer binding to a Stripe Customer to avoid duplicates across checkouts
  try {
    const user = await findUserByUuid(order.user_uuid);
    if (user?.email) {
      const customerId = await getOrCreateCustomerIdForUser({
        uuid: user.uuid,
        email: user.email,
        nickname: user.nickname,
        stripe_customer_id: (user as any).stripe_customer_id,
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
    if (promo?.trial_days && promo.trial_days > 0) {
      (options.subscription_data as any).trial_period_days = promo.trial_days;
    }
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

  // Introductory price: apply a one-time coupon to the first invoice
  if (is_subscription && promo?.intro_months && promo.intro_months > 0 && promo.intro_price_cents) {
    try {
      const discounts = await buildIntroDiscounts({
        currency: (order.currency || "usd") as string,
        baseAmount: order.amount,
        introAmount: promo.intro_price_cents,
      });
      if (discounts && discounts.length > 0) {
        (options as any).discounts = discounts;
        // Stripe Checkout requires choosing between explicit discounts and
        // allow_promotion_codes; remove the latter when discounts are set.
        delete (options as any).allow_promotion_codes;
      }
    } catch (e) {
      // Non-fatal; continue without discount if it fails
      console.warn("failed to apply intro discount", e);
    }
  }

  const session = await client
    .stripe()
    .checkout.sessions.create(options, { idempotencyKey: order.order_no });

  // update order detail
  await updateOrderSession(order.order_no, session.id, JSON.stringify(options));

  return {
    order_no: order.order_no,
    session_id: session.id,
    checkout_url: session.url,
  };
}
