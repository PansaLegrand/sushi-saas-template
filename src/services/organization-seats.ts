import { AppError } from "@/lib/errors/app-error";
import {
  countOrganizationSeatUsage,
  setOrganizationMemberLimitOverride,
  withOrganizationSeatLock,
  type OrgUuid,
} from "@/models/organization";
import { enforceLimit, resolveLimit } from "@/services/entitlements";
import type { OrganizationSeatSummary } from "@/types/team";

const MEMBER_LIMIT = "organization.members" as const;
export const MAX_ADMIN_MEMBER_LIMIT = 100_000;

/** Serialize the capacity check and Better Auth write for one organization. */
export function serializeOrganizationSeatMutation<T>(
  orgId: string,
  work: () => Promise<T>,
): Promise<T> {
  return withOrganizationSeatLock(orgId, work);
}

/** The plan/override decision together with live member and invitation usage. */
export async function getOrganizationSeatSummary(
  orgId: string,
  orgUuid: OrgUuid,
): Promise<OrganizationSeatSummary> {
  const [limit, usage] = await Promise.all([
    resolveLimit(orgUuid, MEMBER_LIMIT),
    countOrganizationSeatUsage(orgId),
  ]);
  const occupied = usage.members + usage.pendingInvitations;
  const effectiveLimit = limit.effectiveValue;

  return {
    planLimit: limit.defaultValue,
    effectiveLimit,
    override: limit.override
      ? {
          limit: limit.override.value,
          expiresAt: limit.override.expiresAt?.toISOString() ?? null,
          active: limit.override.active,
        }
      : null,
    members: usage.members,
    pendingInvitations: usage.pendingInvitations,
    occupied,
    available:
      effectiveLimit === null ? null : Math.max(effectiveLimit - occupied, 0),
    overLimit: effectiveLimit !== null && occupied > effectiveLimit,
  };
}

/**
 * A pending invitation reserves one seat.
 *
 * Re-invites are canceled by Better Auth before its creation hook reaches this
 * check, so replacing a link for the same address does not consume two seats.
 */
export async function assertOrganizationCanInvite(
  orgId: string,
  orgUuid: OrgUuid,
  options: { replacingEmail?: string } = {},
): Promise<void> {
  const usage = await countOrganizationSeatUsage(orgId, {
    excludePendingEmail: options.replacingEmail,
  });
  await enforceLimit(orgUuid, MEMBER_LIMIT, {
    current: usage.members + usage.pendingInvitations,
    adding: 1,
  });
}

/**
 * Recheck on acceptance because the plan or admin exception may have changed
 * since the link was sent. Existing members survive a downgrade; only the new
 * membership is refused while the organization is at or above its new cap.
 */
export async function assertOrganizationCanAcceptInvitation(
  orgId: string,
  orgUuid: OrgUuid,
): Promise<void> {
  const usage = await countOrganizationSeatUsage(orgId);
  await enforceLimit(orgUuid, MEMBER_LIMIT, {
    current: usage.members,
    adding: 1,
  });
}

export async function saveOrganizationSeatLimitOverride(input: {
  orgId: string;
  orgUuid: OrgUuid;
  limit: number;
  expiresAt: Date | null;
}): Promise<OrganizationSeatSummary> {
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_ADMIN_MEMBER_LIMIT
  ) {
    throw new AppError("REQUEST_VALIDATION_FAILED", {
      message: `member limit must be an integer between 1 and ${MAX_ADMIN_MEMBER_LIMIT}`,
      details: { field: "limit" },
    });
  }

  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new AppError("REQUEST_VALIDATION_FAILED", {
      message: "member limit override expiry must be in the future",
      details: { field: "expiresAt" },
    });
  }

  const updated = await setOrganizationMemberLimitOverride(
    input.orgUuid,
    input.limit,
    input.expiresAt,
  );
  if (!updated) {
    throw new AppError("ORG_NOT_FOUND", {
      message: `organization ${input.orgUuid} was not found`,
    });
  }

  return getOrganizationSeatSummary(input.orgId, input.orgUuid);
}

export async function clearOrganizationSeatLimitOverride(input: {
  orgId: string;
  orgUuid: OrgUuid;
}): Promise<OrganizationSeatSummary> {
  const updated = await setOrganizationMemberLimitOverride(
    input.orgUuid,
    null,
    null,
  );
  if (!updated) {
    throw new AppError("ORG_NOT_FOUND", {
      message: `organization ${input.orgUuid} was not found`,
    });
  }

  return getOrganizationSeatSummary(input.orgId, input.orgUuid);
}
