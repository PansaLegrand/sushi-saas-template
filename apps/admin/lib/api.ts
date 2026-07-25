/**
 * Browser-side calls from the admin console.
 *
 * Kept here rather than in `src/api/` for the same reason `apps/admin/lib/data.ts`
 * exists: admin endpoints are not part of the public app's surface, and nothing
 * in `src/` should be able to reach them. See apps/admin/README.md.
 */

import { api } from "@/lib/api/client";
import type { CreditSummary } from "@/types/credit";
import type { PlanSnapshot } from "@/types/plan";

export function getUserCredits(userUuid: string) {
  return api.get<CreditSummary>(
    `/api/admin/users/${encodeURIComponent(userUuid)}/credits`
  );
}

export function grantCredits(input: {
  userUuid: string;
  credits: number;
  expiredAt?: string | null;
  note?: string;
}) {
  return api.post<unknown>("/api/admin/credits/grant", {
    body: {
      ...input,
      // One key per attempt: a retry of this request cannot double-credit.
      idempotencyKey: crypto.randomUUID(),
    },
  });
}

export function getUserPlan(userUuid: string) {
  return api.get<PlanSnapshot>(
    `/api/admin/users/${encodeURIComponent(userUuid)}/plan`
  );
}

/** Comp a user onto a tier. Replaces any comp they already hold. */
export function grantUserPlan(input: {
  userUuid: string;
  tier: string;
  expiresAt?: string | null;
  note?: string;
}) {
  const { userUuid, ...body } = input;
  return api.post<PlanSnapshot>(
    `/api/admin/users/${encodeURIComponent(userUuid)}/plan`,
    { body }
  );
}

export function revokeUserPlan(userUuid: string) {
  return api.delete<{ revoked: number; plan: PlanSnapshot }>(
    `/api/admin/users/${encodeURIComponent(userUuid)}/plan`
  );
}
