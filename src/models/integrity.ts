import { sql } from "drizzle-orm";

import {
  STORAGE_FILE_STATUSES,
  STORAGE_UPLOAD_VISIBILITIES,
} from "@/config/storage";
import { db } from "@/db";

export type DataIntegrityFinding = {
  check: string;
  count: number;
};

/**
 * Read-only integrity sweep for invariants that need an operational preflight.
 *
 * Most checks find relationships the legacy schema cannot enforce with foreign
 * keys. The value checks let a release detect historical rows that would block
 * a later constraint-validation or NOT NULL migration. Tombstoned
 * organizations remain present; erased user subjects use the explicit
 * `erased-subject` sentinel and are excluded from identity checks.
 */
export async function listDataIntegrityFindings(): Promise<
  DataIntegrityFinding[]
> {
  const fileStatuses = sql.join(
    STORAGE_FILE_STATUSES.map((status) => sql`${status}`),
    sql`, `,
  );
  const fileVisibilities = sql.join(
    STORAGE_UPLOAD_VISIBILITIES.map((visibility) => sql`${visibility}`),
    sql`, `,
  );

  const result = await db().execute(sql`
    select 'sessions.user_id' as "check", count(*)::int as "count"
      from sessions child left join users parent on parent.id = child.user_id
      where parent.id is null
    union all
    select 'accounts.user_id', count(*)::int
      from accounts child left join users parent on parent.id = child.user_id
      where parent.id is null
    union all
    select 'two_factor.user_id', count(*)::int
      from two_factor child left join users parent on parent.id = child.user_id
      where parent.id is null
    union all
    select 'org_members.organization_id', count(*)::int
      from org_members child left join organizations parent on parent.id = child.organization_id
      where parent.id is null
    union all
    select 'org_members.user_id', count(*)::int
      from org_members child left join users parent on parent.id = child.user_id
      where parent.id is null
    union all
    select 'org_invitations.organization_id', count(*)::int
      from org_invitations child left join organizations parent on parent.id = child.organization_id
      where parent.id is null
    union all
    select 'org_invitations.inviter_id', count(*)::int
      from org_invitations child left join users parent on parent.id = child.inviter_id
      where parent.id is null
    union all
    select 'orders.org_uuid', count(*)::int
      from orders child left join organizations parent on parent.uuid = child.org_uuid
      where parent.uuid is null
    union all
    select 'credits.org_uuid', count(*)::int
      from credits child left join organizations parent on parent.uuid = child.org_uuid
      where parent.uuid is null
    union all
    select 'reservations.org_uuid', count(*)::int
      from reservations child left join organizations parent on parent.uuid = child.org_uuid
      where parent.uuid is null
    union all
    select 'files.org_uuid', count(*)::int
      from files child left join organizations parent on parent.uuid = child.org_uuid
      where parent.uuid is null
    union all
    select 'tasks.org_uuid', count(*)::int
      from tasks child left join organizations parent on parent.uuid = child.org_uuid
      where parent.uuid is null
    union all
    select 'subscriptions.org_uuid', count(*)::int
      from subscriptions child left join organizations parent on parent.uuid = child.org_uuid
      where parent.uuid is null
    union all
    select 'orders.user_uuid', count(*)::int
      from orders child left join users parent on parent.uuid = child.user_uuid
      where parent.uuid is null and child.user_uuid not in ('', 'erased-subject')
    union all
    select 'credits.user_uuid', count(*)::int
      from credits child left join users parent on parent.uuid = child.user_uuid
      where parent.uuid is null and child.user_uuid <> 'erased-subject'
    union all
    select 'reservations.user_uuid', count(*)::int
      from reservations child left join users parent on parent.uuid = child.user_uuid
      where parent.uuid is null and child.user_uuid <> 'erased-subject'
    union all
    select 'files.user_uuid', count(*)::int
      from files child left join users parent on parent.uuid = child.user_uuid
      where parent.uuid is null and child.user_uuid <> 'erased-subject'
    union all
    select 'tasks.user_uuid', count(*)::int
      from tasks child left join users parent on parent.uuid = child.user_uuid
      where parent.uuid is null and child.user_uuid <> 'erased-subject'
    union all
    select 'subscriptions.user_uuid', count(*)::int
      from subscriptions child left join users parent on parent.uuid = child.user_uuid
      where parent.uuid is null and child.user_uuid <> 'erased-subject'
    union all
    select 'files.status', count(*)::int
      from files
      where status not in (${fileStatuses})
    union all
    select 'files.visibility', count(*)::int
      from files
      where visibility not in (${fileVisibilities})
    union all
    select 'files.size', count(*)::int
      from files
      where size < 0
    union all
    select 'orders.created_at', count(*)::int
      from orders
      where created_at is null
    union all
    select 'credits.created_at', count(*)::int
      from credits
      where created_at is null
    union all
    select 'affiliates.created_at', count(*)::int
      from affiliates
      where created_at is null
    union all
    select 'feedbacks.created_at', count(*)::int
      from feedbacks
      where created_at is null
  `);

  const rows = result as unknown as
    | Array<{ check: string; count: number | string }>
    | { rows?: Array<{ check: string; count: number | string }> };
  const normalized = Array.isArray(rows) ? rows : (rows.rows ?? []);
  return normalized.map((row) => ({
    check: row.check,
    count: Number(row.count),
  }));
}
