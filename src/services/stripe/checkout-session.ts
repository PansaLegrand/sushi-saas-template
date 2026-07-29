import Stripe from "stripe";
import { findOrderByOrderNo } from "@/models/order";
import { markOrderPaidWithGrant } from "@/models/fulfillment";
import { CreditsTransType } from "@/services/credit";
import { updateAffiliateForOrder } from "@/services/affiliate";
import { orderPayTransNo } from "@/services/stripe/idempotency";
import { extractCheckoutPaymentReceipt } from "@/services/stripe/receipt";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger/server";

export async function handleCheckoutSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  const order_no = session.metadata?.order_no;
  if (!order_no) {
    throw new AppError("REQUEST_MISSING_FIELD", {
      message: "stripe checkout session missing metadata.order_no",
      details: { field: "order_no" },
    });
  }

  const order = await findOrderByOrderNo(order_no);
  if (!order) {
    throw new AppError("RESOURCE_NOT_FOUND", {
      message: `order not found for checkout session: ${order_no}`,
    });
  }

  if (!order.org_uuid) {
    // Refusing beats crediting a guessed tenant: the payment is already
    // recorded in Stripe, so this is recoverable by hand, whereas granting to
    // the wrong balance is not.
    throw new AppError("RESOURCE_NOT_FOUND", {
      message: `paid order ${order_no} has no organization to credit`,
    });
  }

  // Deliberately *no* "already paid, nothing to do" early return here.
  //
  // There used to be one, and it was the bug: the status is written before the
  // credits are granted, so a crash in between left an order that reported
  // itself paid and skipped its own grant forever. Replaying the whole thing is
  // safe instead — `markOrderPaidWithGrant` sets a status that is already set
  // and conflicts on a `trans_no` that already exists. Idempotent by
  // construction rather than by inspection.

  const checkoutReceipt = extractCheckoutPaymentReceipt(session);
  let paymentIntentId = checkoutReceipt.payment_intent_id;
  let chargeId: string | null | undefined = checkoutReceipt.charge_id;

  if (paymentIntentId && !chargeId && session.mode === "payment") {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    paymentIntentId = paymentIntent.id;
    chargeId =
      typeof paymentIntent.latest_charge === "string"
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id;
  }

  const paymentReceipt = {
    ...checkoutReceipt,
    payment_intent_id: paymentIntentId,
    charge_id: chargeId,
  };

  if (
    session.currency &&
    order.currency &&
    session.currency !== order.currency
  ) {
    throw new AppError("ORDER_INVALID_PRODUCT", {
      message: `Stripe currency ${session.currency} does not match order ${order.currency}`,
    });
  }

  // The payment and its credits, in one transaction. Stripe's API calls above
  // are deliberately finished first: a transaction holding a pooled connection
  // must not wait on someone else's network.
  const { order: paid, credit_granted } = await markOrderPaidWithGrant({
    order_no,
    org_uuid: order.org_uuid,
    user_uuid: order.user_uuid,
    paid_at: new Date(),
    paid_email: session.customer_details?.email || "",
    paid_detail: JSON.stringify(paymentReceipt),
    amount_paid:
      typeof session.amount_total === "number"
        ? session.amount_total
        : order.amount,
    currency: session.currency ?? order.currency ?? undefined,
    stripe_payment_intent_id: paymentIntentId,
    stripe_charge_id: chargeId,
    grant:
      order.credits && order.credits > 0
        ? {
            trans_no: orderPayTransNo(order_no),
            trans_type: CreditsTransType.OrderPay,
            credits: order.credits,
            expired_at: order.expired_at ?? null,
            actor: "stripe:webhook",
            metadata_json: JSON.stringify({
              stripe_session_id: session.id,
            }),
          }
        : null,
  });

  if (!paid) {
    // The scoped update matched nothing, so the order moved tenant or vanished
    // between the read above and the write. Nothing was committed.
    throw new AppError("RESOURCE_NOT_FOUND", {
      message: `order ${order_no} could not be marked paid for its organization`,
    });
  }

  logger.info(
    {
      event: "pay.order_fulfilled",
      order_no,
      org_id: order.org_uuid,
      user_id: order.user_uuid,
      credits: order.credits ?? 0,
      // False on a replay. Worth distinguishing in the logs: a redelivery that
      // grants nothing is correct, while a *first* delivery that grants nothing
      // means the ledger key collided with something it should not have.
      credit_granted,
    },
    "order fulfilled",
  );

  // Update affiliate rewards for this paid order.
  await updateAffiliateForOrder(paid);
}
