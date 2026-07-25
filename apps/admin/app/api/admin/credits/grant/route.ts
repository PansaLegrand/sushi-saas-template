import { createHash } from "node:crypto";

import { requireSameOrigin } from "@admin/lib/origin";
import { requireAdminWrite } from "@admin/lib/authz";
import { writeAdminAuditLog } from "@admin/lib/audit";
import { getAppEnv } from "@/lib/env";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData, respErr, respNotFound } from "@/lib/resp";
import { findCreditByTransNo } from "@/models/credit";
import { findUserByUuid } from "@/models/user";
import {
  CreditsTransType,
  increaseCredits,
  getUserCreditSummary,
} from "@/services/credit";

interface AdminGrantRequest {
  userUuid: string;
  credits: number;
  expiredAt?: string | Date | null;
  /**
   * Client-generated key, one per grant attempt. Retries reuse it so the grant
   * lands at most once. Required: without it a double-click double-credits.
   */
  idempotencyKey: string;
  note?: string;
}

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
    payload = (await req.json()) as AdminGrantRequest;
  } catch {
    return respErr("invalid params");
  }

  const userUuid = payload?.userUuid;
  if (!userUuid) return respErr("userUuid required");

  const idempotencyKey = payload?.idempotencyKey;
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    return respErr("idempotencyKey required");
  }

  const credits = Number(payload.credits);
  if (!Number.isInteger(credits) || credits <= 0) {
    return respErr("credits must be a positive integer");
  }

  const maxGrant = getAppEnv().ADMIN_MAX_CREDIT_GRANT;
  if (credits > maxGrant) {
    return respErr(`credits must not exceed ${maxGrant}`);
  }

  let expiredAt: Date | null = null;
  if (payload.expiredAt) {
    const parsed = new Date(payload.expiredAt);
    if (Number.isNaN(parsed.getTime())) return respErr("invalid expiredAt");
    expiredAt = parsed;
  }

  const transNo = buildGrantTransNo(admin.userUuid, userUuid, idempotencyKey);

  try {
    const target = await findUserByUuid(userUuid);
    if (!target) return respNotFound("user not found");

    // Fast path for a retry we have already applied.
    let replayed = Boolean(await findCreditByTransNo(transNo));

    if (!replayed) {
      try {
        await increaseCredits({
          user_uuid: userUuid,
          trans_type: CreditsTransType.SystemAdd,
          credits,
          expired_at: expiredAt,
          // Deliberately not client-supplied: an admin grant has no order
          // behind it, and accepting one lets the ledger be forged.
          order_no: "",
          trans_no: transNo,
        });
      } catch (e) {
        // Lost the race against a concurrent identical request; that request
        // applied the grant, so this one is a replay.
        if (!isUniqueViolation(e)) throw e;
        replayed = true;
      }
    }

    const summary = await getUserCreditSummary(userUuid, {
      includeLedger: true,
      ledgerLimit: 50,
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
    console.error("admin grant credits failed", e);

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

    return respErr("admin grant credits failed");
  }
}
