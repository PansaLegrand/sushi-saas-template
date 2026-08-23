import { sql } from "drizzle-orm";

import { db } from "@/db";

export type DataIntegrityFinding = {
  check: string;
  count: number;
};

/**
 * Read-only orphan sweep for relationships that the legacy schema cannot yet
 * enforce with foreign keys. Tombstoned organizations remain present; erased
 * user subjects use the explicit `erased-subject` sentinel and are excluded.
 */
export async function listDataIntegrityFindings(): Promise<
  DataIntegrityFinding[]
> {
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
