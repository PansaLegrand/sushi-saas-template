import Stripe from "stripe";
import { findOrderByOrderNo } from "@/models/order";
import { markOrderPaidWithGrant } from "@/models/fulfillment";
import { CreditsTransType } from "@/services/credit";
import { updateAffiliateForOrder } from "@/services/affiliate";
import { orderPayTransNo } from "@/services/stripe/idempotency";
import { AppError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logger/server";

export async function handleCheckoutSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session
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

  // Retrieve payment details for both one-time and subscription checkouts.
  // - payment mode: session.payment_intent is set
  // - subscription mode: payment_intent is null; we fetch it from the subscription's latest invoice
  let charge_detail = "";

  try {
    if (session.payment_intent) {
      const pi = await stripe.paymentIntents.retrieve(
        session.payment_intent as string
      );
      const charge = (pi as any).latest_charge ?? pi;
      charge_detail = JSON.stringify(charge, null, 2);
    } else if (session.subscription) {
      const sub = await stripe.subscriptions.retrieve(
        session.subscription as string,
        { expand: ["latest_invoice.payment_intent"] as any }
      );
      const latestInvoice = (sub as any).latest_invoice;
      const pi = latestInvoice?.payment_intent;
      charge_detail = JSON.stringify(pi ?? sub, null, 2);
    } else {
      // Fallback: persist the session details
      charge_detail = JSON.stringify(session, null, 2);
    }
  } catch (e) {
    // Do not fail the flow if charge retrieval fails; persist the session as backup.
    logger.warn(
      { err: e, order_no },
      "failed to fetch charge details, falling back to session"
    );
    charge_detail = JSON.stringify(session, null, 2);
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
    paid_detail: charge_detail,
    grant:
      order.credits && order.credits > 0
        ? {
            trans_no: orderPayTransNo(order_no),
            trans_type: CreditsTransType.OrderPay,
            credits: order.credits,
            expired_at: order.expired_at ?? null,
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
    "order fulfilled"
  );

  // Update affiliate rewards for this paid order.
  await updateAffiliateForOrder({
    ...order,
    interval: (order as any).interval ?? "",
  } as any);
}
