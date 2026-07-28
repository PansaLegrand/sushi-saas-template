/**
 * Browser-side calls from the admin console.
 *
 * Kept here rather than in `src/api/` for the same reason `apps/admin/lib/data.ts`
 * exists: admin endpoints are not part of the public app's surface, and nothing
 * in `src/` should be able to reach them. See apps/admin/README.md.
 */

import { api } from "@/lib/api/client";
import type { CreditSummary } from "@/types/credit";
import type {
  BanResult,
  BanState,
  BlocklistEntry,
  BlocklistScope,
  UnbanResult,
} from "@/types/moderation";
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

/** Suspension state, plus any blocklist rule covering the account's address. */
export function getUserBanState(userUuid: string) {
  return api.get<BanState & { blocklistEntries: BlocklistEntry[] }>(
    `/api/admin/users/${encodeURIComponent(userUuid)}/ban`
  );
}

export function banUser(input: {
  userUuid: string;
  reason?: string;
  /** Leave unset to take the server default, which blocks the address. */
  blockEmail?: boolean;
}) {
  const { userUuid, ...body } = input;
  return api.post<BanResult>(
    `/api/admin/users/${encodeURIComponent(userUuid)}/ban`,
    { body }
  );
}

export function unbanUser(input: {
  userUuid: string;
  removeBlocklistEntry?: boolean;
}) {
  const { userUuid, ...body } = input;
  return api.delete<UnbanResult>(
    `/api/admin/users/${encodeURIComponent(userUuid)}/ban`,
    { body }
  );
}

/**
 * `query` accepts an address exactly as a signup log printed it. The server
 * normalizes it before matching, so a rule stored under a different-looking key
 * still comes back — see `buildBlocklistSearch` in `src/services/moderation.ts`.
 */
export function listBlocklist(page = 1, limit = 50, query?: string) {
  return api.get<{
    items: BlocklistEntry[];
    page: number;
    limit: number;
    total: number;
  }>("/api/admin/blocklist", {
    query: query ? { page, limit, q: query } : { page, limit },
  });
}

export function addBlocklistEntry(input: {
  scope: BlocklistScope;
  value: string;
  reason?: string;
  expiresAt?: string | null;
}) {
  return api.post<{ entry: BlocklistEntry; created: boolean }>(
    "/api/admin/blocklist",
    { body: input }
  );
}

/**
 * Close a parked Stripe event. Does not replay it — see the route's own note,
 * and the banner on `/stripe-events`.
 */
export function resolveStripeEvent(input: { eventId: string; note: string }) {
  return api.post<{
    eventId: string;
    status: string;
    resolvedAt: string | null;
  }>(`/api/admin/stripe-events/${encodeURIComponent(input.eventId)}/resolve`, {
    body: { note: input.note },
  });
}

export function removeBlocklistEntry(uuid: string) {
  return api.delete<{ removed: BlocklistEntry }>(
    `/api/admin/blocklist/${encodeURIComponent(uuid)}`
  );
}
