import type Stripe from "stripe";

import { findCreditByOrderNo } from "@/models/credit";
import { findOrderBySubscriptionPeriod } from "@/models/order";
import { getOrgCredits } from "@/services/credit";
import { logger } from "@/lib/logger/server";

/**
 * Work out what reversing a refund *would* cost, without reversing anything.
 *
 * Decided rather than pending: this template never reverses credits
 * automatically. Not because consent is missing — Stripe has no
 * customer-initiated refund, so someone with dashboard access already approved it
 * — but because there is no defensible amount. A partial refund is not a full
 * revocation, and the credits may already be spent, which makes the reversal
 * arithmetically impossible rather than merely unwise. Both available silent
 * answers (leave a negative balance, or revoke less than was refunded) are
 * decisions a person has to own.
 *
 * So the arithmetic is computed here, at write time, and parked on the event for
 * that person. **At write time specifically**: the shortfall is the whole
 * decision being handed over, and recomputing it a day later gives a different
 * answer once the balance has moved.
 *
 * See "Refund handling" under item 5 in roadmap.md.
 */

export type RefundResolution =
  /** Order, grant, and balance all found. The shortfall is meaningful. */
  | "resolved"
  /** No local order for this charge. Nothing to compare a reversal against. */
  | "order_unresolved"
  /** Order found, but it never carried a ledger row — nothing to reverse. */
  | "grant_unresolved";

export type RefundAssessment = {
  kind: "refund" | "dispute";
  resolution: RefundResolution;
  charge_id?: string;
  amount_refunded?: number;
  currency?: string;
  stripe_invoice_id?: string;
  order_no?: string;
  grant_trans_no?: string;
  granted_credits?: number;
  org_uuid?: string;
  /** Spendable balance now — what a reversal could actually take back. */
  current_balance?: number;
  /** Credits granted, minus what is still there. Zero when fully covered. */
  shortfall?: number;
};

/**
 * Resolve the invoice behind the event.
 *
 * A refund arrives as the Charge itself; a dispute arrives as a Dispute holding a
 * charge reference, so it needs one extra lookup. Both are best-effort: a Stripe
 * API blip must not stop the event being parked, because a parked row with
 * partial detail is far better than an unparked one with none.
 */
async function resolveInvoiceId(
  stripe: Stripe,
  object: Stripe.Charge | Stripe.Dispute
): Promise<{ chargeId?: string; invoiceId?: string }> {
  const refOf = (value: unknown): string | undefined => {
    if (typeof value === "string") return value || undefined;
    if (value && typeof value === "object") {
      const id = (value as { id?: unknown }).id;
      return typeof id === "string" ? id : undefined;
    }
    return undefined;
  };

  // A Dispute has `charge`; a Charge has `invoice` and its own id.
  if ("charge" in object) {
    const chargeId = refOf(object.charge);
    if (!chargeId) return {};

    try {
      const charge = await stripe.charges.retrieve(chargeId);
      return { chargeId, invoiceId: refOf(charge.invoice) };
    } catch (e) {
      logger.warn(
        { err: e, event: "stripe.refund_charge_lookup_failed", charge_id: chargeId },
        "could not retrieve the disputed charge"
      );
      return { chargeId };
    }
  }

  return { chargeId: object.id, invoiceId: refOf(object.invoice) };
}

export async function assessRefund(
  stripe: Stripe,
  event: Stripe.Event
): Promise<RefundAssessment> {
  const object = event.data.object as Stripe.Charge | Stripe.Dispute;
  const kind = event.type === "charge.dispute.created" ? "dispute" : "refund";

  const amountRefunded =
    "amount_refunded" in object && typeof object.amount_refunded === "number"
      ? object.amount_refunded
      : typeof object.amount === "number"
        ? object.amount
        : undefined;

  const base: RefundAssessment = {
    kind,
    resolution: "order_unresolved",
    amount_refunded: amountRefunded,
    currency: object.currency ?? undefined,
  };

  const { chargeId, invoiceId } = await resolveInvoiceId(stripe, object);
  base.charge_id = chargeId;
  base.stripe_invoice_id = invoiceId;

  if (!invoiceId) return base;

  // The order number for a renewal is derived from the billing period, so the
  // invoice's subscription and period are what identify it. A checkout charge
  // carries no invoice and lands in the branch above — see the roadmap note on
  // `stripe_payment_intent_id`, which is what would close that gap.
  let subscriptionId: string | undefined;
  let periodStart: number | undefined;

  try {
    const invoice = await stripe.invoices.retrieve(invoiceId);
    subscriptionId =
      typeof invoice.subscription === "string"
        ? invoice.subscription
        : (invoice.subscription?.id ?? undefined);

    const line =
      invoice.lines?.data?.find((l) => l.period?.start) ?? invoice.lines?.data?.[0];
    periodStart = line?.period?.start ?? undefined;
  } catch (e) {
    logger.warn(
      { err: e, event: "stripe.refund_invoice_lookup_failed", invoice_id: invoiceId },
      "could not retrieve the refunded invoice"
    );
    return base;
  }

  if (!subscriptionId || !periodStart) return base;

  const order = await findOrderBySubscriptionPeriod(subscriptionId, periodStart);
  if (!order) return base;

  base.order_no = order.order_no;
  base.org_uuid = order.org_uuid;

  // `findCreditByOrderNo` was kept unused through item 4 for exactly this: the
  // grant's own evidence, looked up by the order it paid for.
  const grant = await findCreditByOrderNo(order.order_no);
  if (!grant) {
    base.resolution = "grant_unresolved";
    return base;
  }

  base.grant_trans_no = grant.trans_no;
  base.granted_credits = grant.credits;

  const { left_credits } = await getOrgCredits(order.org_uuid);
  base.current_balance = left_credits;
  // Spendable balance, not the ledger total: the question is what a reversal
  // could actually take back today, and expired credits cannot be taken back
  // because they are already gone.
  base.shortfall = Math.max(0, grant.credits - left_credits);
  base.resolution = "resolved";

  return base;
}
