import { z } from "zod";

import { writeAdminAuditLog } from "@admin/lib/audit";
import { requireAdminWrite } from "@admin/lib/authz";
import { requireSameOrigin } from "@admin/lib/origin";
import { parseJsonBody } from "@/lib/http/request";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import {
  findStripeWebhookEventById,
  resolveStripeWebhookEvent,
} from "@/models/stripe-webhook-event";

/**
 * Close a parked webhook event.
 *
 * The write half of `/stripe-events`, and deliberately the *only* write half.
 * This does not replay anything: it records that a human dealt with the event
 * outside this system — reversed a refund by hand, accepted a dispute, decided
 * an unmapped price was a test — so the row stops being a work order.
 *
 * Replay stays with Stripe. Pressing Resend in the Stripe dashboard already
 * reclaims a parked row (`action_required` is in `RECLAIMABLE_STATUSES`) and
 * re-runs the handler against a freshly signed payload with Stripe's current
 * state behind it. A console button replaying a stored payload would be running
 * a snapshot of the past through the money path, and would need the webhook's
 * 600-line switch lifted out of its route first. See item 16 in roadmap.md.
 *
 * Resolving is final. A later redelivery is acknowledged and not re-run, so an
 * operator cannot undo this with the Resend button — which is the right way
 * round, but has to be said out loud in the UI, and is.
 */

const ResolveSchema = z.object({
  /**
   * Required, and not optional-with-a-default. This is the whole audit value of
   * the operation: "somebody closed it" without "because we refunded it in
   * Stripe on the 3rd" is a row that answers nothing six months later.
   */
  note: z.string().trim().min(1).max(2000),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ eventId: string }> }
) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "moderation");
  if (limited) return limited;

  const authz = await requireAdminWrite();
  if (authz instanceof Response) return authz;
  const admin = authz;

  const { eventId } = await ctx.params;
  if (!eventId) {
    return respCode("REQUEST_MISSING_FIELD", { details: { field: "eventId" } });
  }

  let payload: z.infer<typeof ResolveSchema>;
  try {
    payload = await parseJsonBody(req, ResolveSchema);
  } catch (error) {
    return respError(error, {
      logFields: { event: "admin.stripe_event.resolve_invalid" },
      fallback: "REQUEST_VALIDATION_FAILED",
    });
  }

  try {
    const resolved = await resolveStripeWebhookEvent({
      eventId,
      actorUuid: admin.userUuid,
      note: payload.note,
    });

    if (!resolved) {
      // The update's own status guard refused it. Read the row back to say why,
      // because "not found" and "already completed" send an operator to two
      // very different places.
      const existing = await findStripeWebhookEventById(eventId);
      if (!existing) return respCode("RESOURCE_NOT_FOUND");

      return respCode("REQUEST_VALIDATION_FAILED", {
        details: { field: "status", status: existing.status },
      });
    }

    await writeAdminAuditLog({
      actor: admin,
      action: "stripe_event.resolve",
      targetType: "stripe_webhook_event",
      targetUuid: eventId,
      note: payload.note,
      metadata: {
        eventType: resolved.event_type,
        previousError: resolved.last_error,
        stripeInvoiceId: resolved.stripe_invoice_id,
        stripeSubscriptionId: resolved.stripe_subscription_id,
        attempts: resolved.attempts,
      },
      request: req,
    });

    return respData({
      eventId: resolved.event_id,
      status: resolved.status,
      resolvedAt: resolved.resolved_at?.toISOString() ?? null,
    });
  } catch (e) {
    await writeAdminAuditLog({
      actor: admin,
      action: "stripe_event.resolve",
      targetType: "stripe_webhook_event",
      targetUuid: eventId,
      status: "failed",
      note: payload.note,
      errorMessage: e instanceof Error ? e.message : String(e),
      request: req,
    });

    return respError(e, {
      logFields: { event: "admin.stripe_event.resolve_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
