-- Backfill: point every existing tenant row at its owner's personal organization.
--
-- Runs after 0012, so every user already has exactly one personal org. The join
-- is therefore total for any row whose `user_uuid` still resolves to a user.
-- Rows whose owner no longer exists keep a null `org_uuid` — deliberately, so
-- orphans surface in the NOT NULL migration that follows rather than being
-- silently attached to somebody.
--
-- Idempotent: every update is guarded on `org_uuid IS NULL`, so a re-run skips
-- rows that are already scoped and can never reassign one.
--
-- The join is repeated per table rather than factored into a temporary view on
-- purpose: a view would depend on every statement sharing one session, which is
-- a property of the migration runner, not of this file.

UPDATE apikeys t SET org_uuid = o.uuid
FROM users u
JOIN org_members m ON m.user_id = u.id
JOIN organizations o ON o.id = m.organization_id AND o.is_personal = true
WHERE t.user_uuid = u.uuid AND t.org_uuid IS NULL;
--> statement-breakpoint

UPDATE credits t SET org_uuid = o.uuid
FROM users u
JOIN org_members m ON m.user_id = u.id
JOIN organizations o ON o.id = m.organization_id AND o.is_personal = true
WHERE t.user_uuid = u.uuid AND t.org_uuid IS NULL;
--> statement-breakpoint

UPDATE files t SET org_uuid = o.uuid
FROM users u
JOIN org_members m ON m.user_id = u.id
JOIN organizations o ON o.id = m.organization_id AND o.is_personal = true
WHERE t.user_uuid = u.uuid AND t.org_uuid IS NULL;
--> statement-breakpoint

UPDATE orders t SET org_uuid = o.uuid
FROM users u
JOIN org_members m ON m.user_id = u.id
JOIN organizations o ON o.id = m.organization_id AND o.is_personal = true
WHERE t.user_uuid = u.uuid AND t.org_uuid IS NULL;
--> statement-breakpoint

UPDATE reservations t SET org_uuid = o.uuid
FROM users u
JOIN org_members m ON m.user_id = u.id
JOIN organizations o ON o.id = m.organization_id AND o.is_personal = true
WHERE t.user_uuid = u.uuid AND t.org_uuid IS NULL;
--> statement-breakpoint

UPDATE subscriptions t SET org_uuid = o.uuid
FROM users u
JOIN org_members m ON m.user_id = u.id
JOIN organizations o ON o.id = m.organization_id AND o.is_personal = true
WHERE t.user_uuid = u.uuid AND t.org_uuid IS NULL;
--> statement-breakpoint

UPDATE tasks t SET org_uuid = o.uuid
FROM users u
JOIN org_members m ON m.user_id = u.id
JOIN organizations o ON o.id = m.organization_id AND o.is_personal = true
WHERE t.user_uuid = u.uuid AND t.org_uuid IS NULL;
