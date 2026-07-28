import { z } from "zod";

import { writeAdminAuditLog } from "@admin/lib/audit";
import { requireAdminRead, requireAdminWrite } from "@admin/lib/authz";
import { requireSameOrigin } from "@admin/lib/origin";
import { parseJsonBody } from "@/lib/http/request";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import {
  banUserAccount,
  findMatchingBlocklistEntries,
  getBanState,
  unbanUserAccount,
} from "@/services/moderation";

/**
 * Suspend and restore accounts.
 *
 * The abuse control, and deliberately not a delete. A ban closes the doors and
 * keeps everything else: the row, the ledger, the uploads, the signup IP. That
 * is not squeamishness about deleting — during an abuse wave the account *is*
 * the evidence, and freeing the address is a favour to whoever is attacking you.
 *
 * Erasure — a person asking for their data back — is a different operation with
 * a different trigger and a policy decision behind it. It is not this endpoint.
 */

const BanSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  /**
   * Defaults true, and the default is the point. Without a blocklist entry the
   * ban closes the accounts that exist and nothing else: the same person clicks
   * "continue with Google", Better Auth creates a fresh user row for that
   * provider, and the fresh row is not banned.
   */
  blockEmail: z.boolean().optional(),
});

const UnbanSchema = z.object({
  /** Off by default: the address may be covered by a rule that predates this account. */
  removeBlocklistEntry: z.boolean().optional(),
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

    const state = await getBanState(uuid);
    if (!state) return respCode("ACCOUNT_NOT_FOUND");

    // Returned alongside the ban state because the two answer one question
    // together. An account that is not banned but whose address is blocked can
    // still sign in and cannot re-register, and an admin looking at "banned:
    // false" alone would conclude the opposite.
    return respData({
      ...state,
      blocklistEntries: await findMatchingBlocklistEntries(state.email),
    });
  } catch (e) {
    return respError(e, {
      logFields: { event: "admin.ban.read_failed" },
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

  const limited = await rateLimitOrThrow(req, "moderation");
  if (limited) return limited;

  const authz = await requireAdminWrite();
  if (authz instanceof Response) return authz;
  const admin = authz;

  const { uuid } = await ctx.params;
  if (!uuid) {
    return respCode("REQUEST_MISSING_FIELD", { details: { field: "uuid" } });
  }

  let payload: z.infer<typeof BanSchema>;
  try {
    payload = await parseJsonBody(req, BanSchema);
  } catch (error) {
    return respError(error, {
      logFields: { event: "admin.ban.invalid" },
      fallback: "REQUEST_VALIDATION_FAILED",
    });
  }

  // An admin banning themselves locks the console for everyone who shares that
  // account and cannot be undone from inside it. Guarded here rather than
  // relying on care, because the uuid field is a paste target during exactly
  // the kind of incident where nobody is being careful.
  if (uuid === admin.userUuid) {
    return respCode("AUTH_FORBIDDEN", { details: { reason: "self" } });
  }

  try {
    const outcome = await banUserAccount({
      userUuid: uuid,
      reason: payload.reason ?? null,
      actorUuid: admin.userUuid,
      blockEmail: payload.blockEmail,
    });

    if (outcome.status === "not-found") return respCode("ACCOUNT_NOT_FOUND");
    const { result } = outcome;

    // Written even when the account was already banned: a repeat ban still
    // revoked sessions, and "who tried, and when" is the part of an incident
    // timeline that is impossible to reconstruct later.
    await writeAdminAuditLog({
      actor: admin,
      action: "user.ban",
      targetType: "user",
      targetUuid: uuid,
      note: payload.reason,
      metadata: {
        targetEmail: result.email,
        applied: result.applied,
        alsoBanned: result.alsoBanned,
        sessionsRevoked: result.sessionsRevoked,
        blocklisted: result.blocklisted?.value ?? null,
      },
      request: req,
    });

    return respData(result);
  } catch (e) {
    await writeAdminAuditLog({
      actor: admin,
      action: "user.ban",
      targetType: "user",
      targetUuid: uuid,
      status: "failed",
      note: payload.reason,
      errorMessage: e instanceof Error ? e.message : String(e),
      request: req,
    });

    return respError(e, {
      logFields: { event: "admin.ban.failed" },
      fallback: "SERVER_ERROR",
    });
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ uuid: string }> }
) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "moderation");
  if (limited) return limited;

  const authz = await requireAdminWrite();
  if (authz instanceof Response) return authz;
  const admin = authz;

  const { uuid } = await ctx.params;
  if (!uuid) {
    return respCode("REQUEST_MISSING_FIELD", { details: { field: "uuid" } });
  }

  // An unban carries no body from the UI's simple path, so an absent one is
  // valid input rather than a malformed request.
  let payload: z.infer<typeof UnbanSchema> = {};
  if (req.headers.get("content-type")?.includes("application/json")) {
    try {
      payload = await parseJsonBody(req, UnbanSchema);
    } catch (error) {
      return respError(error, {
        logFields: { event: "admin.unban.invalid" },
        fallback: "REQUEST_VALIDATION_FAILED",
      });
    }
  }

  try {
    const outcome = await unbanUserAccount({
      userUuid: uuid,
      removeBlocklistEntry: payload.removeBlocklistEntry,
    });

    if (outcome.status === "not-found") return respCode("ACCOUNT_NOT_FOUND");
    const { result } = outcome;

    await writeAdminAuditLog({
      actor: admin,
      action: "user.unban",
      targetType: "user",
      targetUuid: uuid,
      metadata: {
        applied: result.applied,
        alsoUnbanned: result.alsoUnbanned,
        removedBlocklistEntry: Boolean(payload.removeBlocklistEntry),
        blocklistEntriesRemaining: result.remainingBlocklistEntries.length,
      },
      request: req,
    });

    return respData(result);
  } catch (e) {
    await writeAdminAuditLog({
      actor: admin,
      action: "user.unban",
      targetType: "user",
      targetUuid: uuid,
      status: "failed",
      errorMessage: e instanceof Error ? e.message : String(e),
      request: req,
    });

    return respError(e, {
      logFields: { event: "admin.unban.failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
