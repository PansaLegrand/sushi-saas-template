import { z } from "zod";

import { writeAdminAuditLog } from "@admin/lib/audit";
import { requireAdminRead, requireAdminWrite } from "@admin/lib/authz";
import { requireSameOrigin } from "@admin/lib/origin";
import { parseJsonBody } from "@/lib/http/request";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { addBlocklistEntry, listBlocklist } from "@/services/moderation";

/**
 * The signup blocklist.
 *
 * Separate from banning because the two answer different questions. A ban
 * closes accounts that exist; a blocklist rule stops one from being created —
 * including by someone who has never registered, and including through a
 * provider they have not used yet.
 *
 * A `domain` rule is the one that ends a signup flood: a single row for a
 * disposable-mail host beats four thousand address rows added one at a time.
 */

const AddEntrySchema = z.object({
  scope: z.enum(["email", "domain"]),
  /** An address or a bare host. Normalized server-side; never trust a client's key. */
  value: z.string().trim().min(1).max(255),
  reason: z.string().trim().max(500).optional(),
  /** ISO date. Omit for a permanent rule. */
  expiresAt: z.string().trim().optional(),
});

export async function GET(req: Request) {
  const authz = await requireAdminRead();
  if (authz instanceof Response) return authz;

  try {
    const url = new URL(req.url);
    const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1),
      100
    );

    const query = url.searchParams.get("q")?.trim() || undefined;

    const { items, total } = await listBlocklist(page, limit, query);

    return respData({ items, page, limit, total });
  } catch (e) {
    return respError(e, {
      logFields: { event: "admin.blocklist.list_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}

export async function POST(req: Request) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "moderation");
  if (limited) return limited;

  const authz = await requireAdminWrite();
  if (authz instanceof Response) return authz;
  const admin = authz;

  let payload: z.infer<typeof AddEntrySchema>;
  try {
    payload = await parseJsonBody(req, AddEntrySchema);
  } catch (error) {
    return respError(error, {
      logFields: { event: "admin.blocklist.add_invalid" },
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
    const outcome = await addBlocklistEntry({
      scope: payload.scope,
      value: payload.value,
      reason: payload.reason ?? null,
      actorUuid: admin.userUuid,
      expiresAt,
    });

    // Unparseable input, not a server failure: an address with no domain or a
    // host with no dot has no key to match on.
    if (outcome.status === "invalid") {
      return respCode("REQUEST_VALIDATION_FAILED", {
        details: { field: "value" },
      });
    }

    // No audit entry for a re-add. Nothing changed, and a trail that records
    // non-events is one people stop reading.
    if (outcome.status === "added") {
      await writeAdminAuditLog({
        actor: admin,
        action: "blocklist.add",
        targetType: "blocklist",
        targetUuid: outcome.entry.uuid,
        note: payload.reason,
        metadata: {
          scope: outcome.entry.scope,
          value: outcome.entry.value,
          originalValue: outcome.entry.originalValue,
          expiresAt: outcome.entry.expiresAt,
        },
        request: req,
      });
    }

    return respData({
      entry: outcome.entry,
      created: outcome.status === "added",
    });
  } catch (e) {
    return respError(e, {
      logFields: { event: "admin.blocklist.add_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
