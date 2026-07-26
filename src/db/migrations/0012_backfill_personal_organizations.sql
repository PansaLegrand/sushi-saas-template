-- Backfill: give every pre-tenancy user a personal organization.
--
-- The invariant the application relies on is that a user *always* has at least
-- one organization. Accounts created before the organization plugin existed
-- have none, and would load no data at all once queries become org-scoped.
--
-- Idempotent by construction: the `not exists` guard makes a re-run a no-op,
-- and every generated id is derived from the user id rather than randomly, so a
-- partial run followed by a retry cannot produce two orgs for one user.
--
-- One statement, so a failure part-way through cannot leave an organization
-- with no owner. `candidates` is evaluated once and both inserts read it.

WITH candidates AS (
  SELECT
    u.id AS user_id,
    md5('org:' || u.id)                         AS org_id,
    md5('org-uuid:' || u.id)                    AS org_uuid,
    -- The local part, never the full address: an org name is visible to every
    -- member, and on a shared team that would disclose the owner's email.
    COALESCE(NULLIF(u.nickname, ''), NULLIF(split_part(u.email, '@', 1), ''), 'workspace')
                                                AS org_name,
    'w-' || substr(md5('slug:' || u.id), 1, 16) AS org_slug,
    md5('member:' || u.id)                      AS member_id
  FROM users u
  WHERE NOT EXISTS (
    SELECT 1 FROM org_members m WHERE m.user_id = u.id
  )
),
inserted_orgs AS (
  INSERT INTO organizations (id, uuid, name, slug, is_personal, created_at, updated_at)
  SELECT org_id, org_uuid, org_name, org_slug, true, now(), now()
  FROM candidates
  RETURNING id
)
INSERT INTO org_members (id, organization_id, user_id, role, created_at)
SELECT member_id, org_id, user_id, 'owner', now()
FROM candidates;
