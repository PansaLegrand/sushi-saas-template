import { writeAdminAuditLog } from "@admin/lib/audit";
import { requireAdminWrite } from "@admin/lib/authz";
import { requireSameOrigin } from "@admin/lib/origin";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { removeBlocklistEntry } from "@/services/moderation";

/** Lift one blocklist rule. */
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

  try {
    const removed = await removeBlocklistEntry(uuid);
    if (!removed) return respCode("RESOURCE_NOT_FOUND");

    // The removed rule is recorded in full. The row itself is gone, so the
    // audit entry is the only remaining answer to "what was blocked, and who
    // decided it should stop being" — which is the question asked when a
    // blocked address turns out to have been a real customer.
    await writeAdminAuditLog({
      actor: admin,
      action: "blocklist.remove",
      targetType: "blocklist",
      targetUuid: uuid,
      metadata: {
        scope: removed.scope,
        value: removed.value,
        originalValue: removed.originalValue,
        reason: removed.reason,
        addedBy: removed.createdBy,
      },
      request: req,
    });

    return respData({ removed });
  } catch (e) {
    return respError(e, {
      logFields: { event: "admin.blocklist.remove_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
