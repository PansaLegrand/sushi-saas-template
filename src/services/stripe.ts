import Stripe from "stripe";
import {
  findOrderByOrderNo,
  OrderStatus,
  updateOrderStatus,
} from "@/models/order";
import { increaseCredits, CreditsTransType } from "@/services/credit";

export async function handleCheckoutSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session
) {
  const order_no = session.metadata?.order_no;
  if (!order_no) {
    throw new Error("invalid order_no");
  }

  const order = await findOrderByOrderNo(order_no);
  if (!order) {
    throw new Error("order not found");
  }

  if (order.status === "paid") {
    console.log("order already paid");
    return;
  }

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
    console.warn("failed to fetch charge details, falling back to session", e);
    charge_detail = JSON.stringify(session, null, 2);
  }

  await updateOrderStatus(
    order_no,
    OrderStatus.Paid,
    new Date().toISOString(),
    session.customer_details?.email || "",
    charge_detail
  );

  if (order.credits && order.credits > 0) {
    await increaseCredits({
      user_uuid: order.user_uuid,
      trans_type: CreditsTransType.OrderPay,
      credits: order.credits,
      expired_at: order.expired_at ?? undefined,
      order_no: order.order_no,
    });
  }
}
