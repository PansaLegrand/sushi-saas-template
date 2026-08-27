import type Stripe from "stripe";

import { newStripeClient } from "@/integrations/stripe";
import { cancelAffiliateRewardForOrder } from "@/services/affiliate";
import { enqueueJob } from "@/services/jobs";

import { ActionRequiredError } from "./action-required";
import { assessRefund } from "./refund";

/**
 * Record the evidence needed to resolve money moving back out of the system.
 *
 * Credits are intentionally not reversed automatically: partial refunds do not
 * map to a full grant, spent credits can make reversal impossible, and disputes
 * can still be won. The durable action-required receipt is the policy boundary.
 */
export async function handleRefundOrDisputeEvent(
  event: Stripe.Event,
): Promise<never> {
  const charge = event.data.object as Stripe.Charge | Stripe.Dispute;
  const assessment = await assessRefund(newStripeClient().stripe(), event);

  if (assessment.order_no) {
    await cancelAffiliateRewardForOrder(assessment.order_no);
  }

  await enqueueJob(
    "slack_error",
    {
      title:
        event.type === "charge.refunded"
          ? "Charge refunded — review credits and access"
          : "Chargeback opened — review credits and access",
      context: {
        event_type: event.type,
        charge_id: "charge" in charge ? String(charge.charge) : charge.id,
        amount:
          typeof charge.amount === "number" ? charge.amount / 100 : undefined,
        currency: charge.currency,
        ...assessment,
      },
    },
    { dedupeKey: `slack_error:${event.id}:${event.type}` },
  );

  // Throw after the alert is durable. Completing would claim the entitlement
  // still in place matches the money that moved back out, which is untrue until
  // an operator explicitly resolves it.
  throw new ActionRequiredError(
    event.type === "charge.refunded" ? "charge_refunded" : "charge_disputed",
    {
      charge_id: assessment.charge_id,
      resolution: assessment.resolution,
      order_no: assessment.order_no,
      grant_trans_no: assessment.grant_trans_no,
      granted_credits: assessment.granted_credits,
      current_balance: assessment.current_balance,
      shortfall: assessment.shortfall,
    },
  );
}
