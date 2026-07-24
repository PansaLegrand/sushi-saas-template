import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";

import { db } from "@/db";
import { adminAuditLogs } from "@/db/schema";
import type { AdminContext } from "@admin/lib/authz";

export type AdminAuditAction = "credits.grant";

interface WriteAuditLogParams {
  actor: AdminContext;
  action: AdminAuditAction;
  targetType: string;
  targetUuid: string;
  status?: "succeeded" | "failed";
  note?: string | null;
  metadata?: unknown;
  errorMessage?: string | null;
  request?: Request;
}

function getRequestIp(req: Request | undefined): string | null {
  if (!req) return null;

  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }

  return (
    req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || null
  );
}

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Append an entry to the admin audit trail.
 *
 * Never throws: a failure to record the trail must not mask the outcome of the
 * action itself, but it is logged loudly so the gap is visible.
 */
export async function writeAdminAuditLog({
  actor,
  action,
  targetType,
  targetUuid,
  status = "succeeded",
  note,
  metadata,
  errorMessage,
  request,
}: WriteAuditLogParams): Promise<void> {
  try {
    await db()
      .insert(adminAuditLogs)
      .values({
        uuid: randomUUID(),
        actor_uuid: actor.userUuid,
        actor_email: actor.email ?? "",
        actor_role: actor.role,
        action,
        target_type: targetType,
        target_uuid: targetUuid,
        status,
        note: truncate(note ?? null, 2000),
        metadata_json:
          metadata === undefined ? null : JSON.stringify(metadata),
        error_message: truncate(errorMessage ?? null, 2000),
        ip_address: truncate(getRequestIp(request), 255),
        user_agent: truncate(request?.headers.get("user-agent") ?? null, 1024),
      });
  } catch (e) {
    console.error("failed to write admin audit log", {
      action,
      targetType,
      targetUuid,
      error: e,
    });
  }
}

export async function listAdminAuditLogs(page: number = 1, limit: number = 50) {
  const offset = (page - 1) * limit;

  return db()
    .select()
    .from(adminAuditLogs)
    .orderBy(desc(adminAuditLogs.created_at))
    .limit(limit)
    .offset(offset);
}

export async function countAdminAuditLogs(): Promise<number> {
  return db().$count(adminAuditLogs);
}
