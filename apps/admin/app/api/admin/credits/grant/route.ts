import { createHash } from "node:crypto";

import { z } from "zod";

import { requireSameOrigin } from "@admin/lib/origin";
import { requireAdminWrite } from "@admin/lib/authz";
import { writeAdminAuditLog } from "@admin/lib/audit";
import { getAppEnv } from "@/lib/env";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { logger } from "@/lib/logger/server";
import { parseJsonBody } from "@/lib/http/request";
import { findCreditByTransNo } from "@/models/credit";
import { findPersonalOrganizationByUserUuid } from "@/models/organization";
import { findUserByUuid } from "@/models/user";
import {
  CreditsTransType,
  increaseCredits,
  getOrgCreditSummary,
} from "@/services/credit";

interface AdminGrantRequest {
  userUuid: string;
  credits: string | number;
  expiredAt?: string | Date | null;
  /**
   * Client-generated key, one per grant attempt. Retries reuse it so the grant
   * lands at most once. Required: without it a double-click double-credits.
   */
  idempotencyKey: string;
  note?: string;
}

const AdminGrantSchema = z.object({
  userUuid: z.string().trim().min(1),
  credits: z.union([z.string(), z.number()]),
  expiredAt: z.string().trim().nullable().optional(),
  idempotencyKey: z.string().trim().min(1),
  note: z.string().trim().optional(),
});

/**
 * Deterministic ledger id for a grant attempt. `credits.trans_no` is unique, so
 * a replay collides on insert rather than creating a second entry. The actor
 * and target are folded in so one key cannot be reused for a different grant.
 */
function buildGrantTransNo(
  actorUuid: string,
  userUuid: string,
  idempotencyKey: string
): string {
  const digest = createHash("sha256")
    .update(`${actorUuid}:${userUuid}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 40);

  return `admin_grant_${digest}`;
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  if (code === "23505") return true;

  const cause = (e as { cause?: { code?: string } } | null)?.cause;
  return cause?.code === "23505";
}

export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "credits");
  if (limited) return limited;

  const authz = await requireAdminWrite();
  if (authz instanceof Response) return authz;
  const admin = authz;

  let payload: AdminGrantRequest | null = null;
  try {
    payload = await parseJsonBody(req, AdminGrantSchema);
  } catch (error) {
    return respError(error, {
      logFields: { event: "admin.credits.grant_invalid" },
      fallback: "REQUEST_VALIDATION_FAILED",
    });
  }

  const userUuid = payload.userUuid;
  const idempotencyKey = payload.idempotencyKey;
  const credits = Number(payload.credits);

  if (!Number.isInteger(credits) || credits <= 0) {
    return respCode("CREDITS_INVALID_AMOUNT");
  }

  const maxGrant = getAppEnv().ADMIN_MAX_CREDIT_GRANT;
  if (credits > maxGrant) {
    return respCode("CREDITS_GRANT_LIMIT_EXCEEDED", {
      details: { max: maxGrant },
    });
  }

  let expiredAt: Date | null = null;
  if (payload.expiredAt) {
    const parsed = new Date(payload.expiredAt);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      return respCode("REQUEST_VALIDATION_FAILED", {
        details: { field: "expiredAt" },
      });
    }
    expiredAt = parsed;
  }

  const transNo = buildGrantTransNo(admin.userUuid, userUuid, idempotencyKey);

  try {
    const target = await findUserByUuid(userUuid);
    if (!target) return respCode("ACCOUNT_NOT_FOUND");

    // A grant lands in the recipient's personal workspace balance.
    const targetOrg = await findPersonalOrganizationByUserUuid(userUuid);
    if (!targetOrg) return respCode("ACCOUNT_NOT_FOUND");

    // Fast path for a retry we have already applied.
    let replayed = Boolean(await findCreditByTransNo(transNo));

    if (!replayed) {
      try {
        await increaseCredits({
          org_uuid: targetOrg.uuid,
          user_uuid: userUuid,
          trans_type: CreditsTransType.SystemAdd,
          credits,
          expired_at: expiredAt,
          // Deliberately not client-supplied: an admin grant has no order
          // behind it, and accepting one lets the ledger be forged.
          order_no: "",
          trans_no: transNo,
          // The admin who issued it, NOT the recipient — `user_uuid` above
          // already holds the recipient. Separating the two is the entire point
          // of this column: "who was credited" and "who decided to" are
          // different questions, and only the second one is accountability.
          actor: `admin:${admin.userUuid}`,
          metadata: { idempotency_key: idempotencyKey },
        });
      } catch (e) {
        // Lost the race against a concurrent identical request; that request
        // applied the grant, so this one is a replay.
        if (!isUniqueViolation(e)) throw e;
        replayed = true;
      }
    }

    const summary = await getOrgCreditSummary(targetOrg.uuid, {
      includeLedger: true,
      ledgerLimit: 50,
      // The grant just written shows up in this ledger, so the admin can see
      // their own `admin:<uuid>` on it and confirm it landed as intended.
      includeAudit: true,
    });

    if (!replayed) {
      await writeAdminAuditLog({
        actor: admin,
        action: "credits.grant",
        targetType: "user",
        targetUuid: userUuid,
        note: payload.note,
        metadata: {
          credits,
          transNo,
          expiredAt: expiredAt?.toISOString() ?? null,
          targetEmail: target.email,
          balanceAfter: summary.balance,
        },
        request: req,
      });
    }

    return respData({
      userUuid,
      creditsGranted: credits,
      transNo,
      replayed,
      summary,
    });
  } catch (e) {
    logger.error(
      {
        err: e,
        event: "admin.credits_grant_failed",
        target_user_uuid: userUuid,
        credits,
        trans_no: transNo,
      },
      "admin grant credits failed"
    );

    await writeAdminAuditLog({
      actor: admin,
      action: "credits.grant",
      targetType: "user",
      targetUuid: userUuid,
      status: "failed",
      note: payload.note,
      metadata: { credits, transNo },
      errorMessage: e instanceof Error ? e.message : String(e),
      request: req,
    });

    return respError(e, {
      logFields: { event: "admin.credits.grant_failed" },
      fallback: "CREDITS_GRANT_FAILED",
    });
  }
}
