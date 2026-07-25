import { z } from "zod";

import { writeAdminAuditLog } from "@admin/lib/audit";
import { requireAdminRead, requireAdminWrite } from "@admin/lib/authz";
import { requireSameOrigin } from "@admin/lib/origin";
import { parseJsonBody } from "@/lib/http/request";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { findUserByUuid } from "@/models/user";
import { getPlanSnapshot } from "@/services/entitlements";
import {
  grantManualSubscription,
  revokeManualSubscriptions,
} from "@/services/subscriptions";

/**
 * Read and comp a user's plan.
 *
 * Comping exists because every product eventually needs it — a design partner,
 * an apology, a teammate's own account — and every product that did not plan
 * for it ends up with someone editing subscription rows by hand in production.
 * A comp here is an ordinary subscription row with `source = "manual"`, so it
 * resolves through the same entitlement path as a paid one.
 *
 * Deliberately cannot touch a Stripe subscription. Changing what someone pays
 * belongs in Stripe, where the proration, the invoice, and the audit trail
 * already live.
 */

const GrantPlanSchema = z.object({
  tier: z.string().trim().min(1),
  /** ISO date. Omit for an indefinite comp. */
  expiresAt: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ uuid: string }> }
) {
  const authz = await requireAdminRead();
  if (authz instanceof Response) return authz;

  try {
    const { uuid } = await ctx.params;
    if (!uuid) {
      return respCode("REQUEST_MISSING_FIELD", { details: { field: "uuid" } });
    }

    // Without this an unknown uuid returns a free-plan snapshot that reads
    // like a real user on the free tier.
    const user = await findUserByUuid(uuid);
    if (!user) return respCode("ACCOUNT_NOT_FOUND");

    return respData(await getPlanSnapshot(uuid));
  } catch (e) {
    return respError(e, {
      logFields: { event: "admin.user_plan_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ uuid: string }> }
) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "credits");
  if (limited) return limited;

  const authz = await requireAdminWrite();
  if (authz instanceof Response) return authz;
  const admin = authz;

  const { uuid } = await ctx.params;
  if (!uuid) {
    return respCode("REQUEST_MISSING_FIELD", { details: { field: "uuid" } });
  }

  let payload: z.infer<typeof GrantPlanSchema>;
  try {
    payload = await parseJsonBody(req, GrantPlanSchema);
  } catch (error) {
    return respError(error, {
      logFields: { event: "admin.plan.comp_invalid" },
      fallback: "REQUEST_VALIDATION_FAILED",
    });
  }

  let expiresAt: Date | null = null;
  if (payload.expiresAt) {
    const parsed = new Date(payload.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return respCode("REQUEST_VALIDATION_FAILED", {
        details: { field: "expiresAt" },
      });
    }
    expiresAt = parsed;
  }

  try {
    const target = await findUserByUuid(uuid);
    if (!target) return respCode("ACCOUNT_NOT_FOUND");

    // One comp at a time: granting a second while the first is live would
    // leave two rows and make revocation ambiguous.
    await revokeManualSubscriptions(uuid);

    const result = await grantManualSubscription({
      userUuid: uuid,
      tier: payload.tier,
      expiresAt,
      note: payload.note,
    });

    if (result.status === "invalid-tier") {
      return respCode("REQUEST_VALIDATION_FAILED", {
        details: { field: "tier" },
      });
    }

    await writeAdminAuditLog({
      actor: admin,
      action: "plan.comp.grant",
      targetType: "user",
      targetUuid: uuid,
      note: payload.note,
      metadata: {
        tier: payload.tier,
        expiresAt: expiresAt?.toISOString() ?? null,
        targetEmail: target.email,
      },
      request: req,
    });

    return respData(await getPlanSnapshot(uuid));
  } catch (e) {
    await writeAdminAuditLog({
      actor: admin,
      action: "plan.comp.grant",
      targetType: "user",
      targetUuid: uuid,
      status: "failed",
      metadata: { tier: payload.tier },
      errorMessage: e instanceof Error ? e.message : String(e),
      request: req,
    });

    return respError(e, {
      logFields: { event: "admin.plan.comp_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}

/** Revoke every comp a user holds. Paid subscriptions are untouched. */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ uuid: string }> }
) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const authz = await requireAdminWrite();
  if (authz instanceof Response) return authz;
  const admin = authz;

  const { uuid } = await ctx.params;
  if (!uuid) {
    return respCode("REQUEST_MISSING_FIELD", { details: { field: "uuid" } });
  }

  try {
    const revoked = await revokeManualSubscriptions(uuid);

    if (revoked > 0) {
      await writeAdminAuditLog({
        actor: admin,
        action: "plan.comp.revoke",
        targetType: "user",
        targetUuid: uuid,
        metadata: { revoked },
        request: req,
      });
    }

    return respData({ revoked, plan: await getPlanSnapshot(uuid) });
  } catch (e) {
    return respError(e, {
      logFields: { event: "admin.plan.revoke_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
