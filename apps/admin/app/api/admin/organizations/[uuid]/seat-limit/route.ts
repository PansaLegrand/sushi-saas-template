import { z } from "zod";

import { writeAdminAuditLog } from "@admin/lib/audit";
import { requireAdminWrite } from "@admin/lib/authz";
import { requireSameOrigin } from "@admin/lib/origin";
import { parseJsonBody } from "@/lib/http/request";
import { AppError } from "@/lib/errors/app-error";
import { rateLimitOrThrow } from "@/lib/rate-limit";
import { respData } from "@/lib/resp";
import { respCode, respError } from "@/lib/errors/response";
import { asOrgUuid, findOrganizationByUuid } from "@/models/organization";
import {
  clearOrganizationSeatLimitOverride,
  MAX_ADMIN_MEMBER_LIMIT,
  saveOrganizationSeatLimitOverride,
} from "@/services/organization-seats";

const NoteSchema = z.string().trim().min(3).max(2_000);
const SaveSchema = z.object({
  limit: z.number().int().min(1).max(MAX_ADMIN_MEMBER_LIMIT),
  expiresAt: z.string().trim().nullable().optional(),
  note: NoteSchema,
});
const ResetSchema = z.object({ note: NoteSchema });

function params(route: { params: Promise<{ uuid: string }> }) {
  return route.params;
}

/** Set a temporary or indefinite per-organization exception to the plan cap. */
export async function POST(
  req: Request,
  route: { params: Promise<{ uuid: string }> },
) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "moderation");
  if (limited) return limited;

  const authz = await requireAdminWrite();
  if (authz instanceof Response) return authz;
  const admin = authz;

  let payload: z.infer<typeof SaveSchema>;
  try {
    payload = await parseJsonBody(req, SaveSchema);
  } catch (error) {
    return respError(error, {
      logFields: { event: "admin.organization_seat_limit_invalid" },
      fallback: "REQUEST_VALIDATION_FAILED",
    });
  }

  const { uuid } = await params(route);
  let expiresAt: Date | null = null;
  if (payload.expiresAt) {
    expiresAt = new Date(payload.expiresAt);
    if (
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {
      return respCode("REQUEST_VALIDATION_FAILED", {
        details: { field: "expiresAt" },
      });
    }
  }

  try {
    const organization = await findOrganizationByUuid(uuid);
    if (!organization) {
      throw new AppError("ORG_NOT_FOUND", {
        message: `organization ${uuid} was not found`,
      });
    }

    const summary = await saveOrganizationSeatLimitOverride({
      orgId: organization.id,
      orgUuid: asOrgUuid(organization.uuid),
      limit: payload.limit,
      expiresAt,
    });

    await writeAdminAuditLog({
      actor: admin,
      action: "organization.seat_limit.override",
      targetType: "organization",
      targetUuid: organization.uuid,
      note: payload.note,
      metadata: {
        previousLimit: organization.member_limit_override,
        previousExpiresAt:
          organization.member_limit_override_expires_at?.toISOString() ?? null,
        limit: payload.limit,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
      request: req,
    });

    return respData(summary);
  } catch (error) {
    await writeAdminAuditLog({
      actor: admin,
      action: "organization.seat_limit.override",
      targetType: "organization",
      targetUuid: uuid,
      status: "failed",
      note: payload.note,
      metadata: { limit: payload.limit, expiresAt: payload.expiresAt ?? null },
      errorMessage: error instanceof Error ? error.message : String(error),
      request: req,
    });
    return respError(error, {
      logFields: { event: "admin.organization_seat_limit_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}

/** Remove the exception. The current plan limit becomes effective immediately. */
export async function DELETE(
  req: Request,
  route: { params: Promise<{ uuid: string }> },
) {
  const invalidOrigin = requireSameOrigin(req);
  if (invalidOrigin) return invalidOrigin;

  const limited = await rateLimitOrThrow(req, "moderation");
  if (limited) return limited;

  const authz = await requireAdminWrite();
  if (authz instanceof Response) return authz;
  const admin = authz;

  let payload: z.infer<typeof ResetSchema>;
  try {
    payload = await parseJsonBody(req, ResetSchema);
  } catch (error) {
    return respError(error, {
      logFields: { event: "admin.organization_seat_limit_reset_invalid" },
      fallback: "REQUEST_VALIDATION_FAILED",
    });
  }

  const { uuid } = await params(route);
  try {
    const organization = await findOrganizationByUuid(uuid);
    if (!organization) {
      throw new AppError("ORG_NOT_FOUND", {
        message: `organization ${uuid} was not found`,
      });
    }

    const summary = await clearOrganizationSeatLimitOverride({
      orgId: organization.id,
      orgUuid: asOrgUuid(organization.uuid),
    });

    await writeAdminAuditLog({
      actor: admin,
      action: "organization.seat_limit.reset",
      targetType: "organization",
      targetUuid: organization.uuid,
      note: payload.note,
      metadata: {
        previousLimit: organization.member_limit_override,
        previousExpiresAt:
          organization.member_limit_override_expires_at?.toISOString() ?? null,
        planLimit: summary.planLimit,
      },
      request: req,
    });

    return respData(summary);
  } catch (error) {
    await writeAdminAuditLog({
      actor: admin,
      action: "organization.seat_limit.reset",
      targetType: "organization",
      targetUuid: uuid,
      status: "failed",
      note: payload.note,
      errorMessage: error instanceof Error ? error.message : String(error),
      request: req,
    });
    return respError(error, {
      logFields: { event: "admin.organization_seat_limit_reset_failed" },
      fallback: "SERVER_ERROR",
    });
  }
}
