-- Close the tenancy hole: `org_uuid` becomes mandatory.
--
-- Until now the column was nullable so that 0013 could add it, 0014 could
-- backfill it, and the application could start writing it, in that order. A row
-- with a null `org_uuid` is invisible to every scoped read — the data is not
-- lost, it is unreachable, and nothing errors. This constraint is what makes
-- that state impossible rather than merely unlikely.
--
-- The check below runs first and fails with a readable message. A bare
-- `SET NOT NULL` would abort with "column contains null values" and no
-- indication of which table, how many rows, or what to do about it.
--
-- If it does fail: the nulls are rows whose `user_uuid` no longer resolves to a
-- user, which 0014 deliberately left alone rather than filing under a guessed
-- tenant. Decide per table whether they are deletable history or need
-- reassigning, then re-run.

DO $$
DECLARE
  t text;
  orphans bigint;
  report text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'apikeys', 'credits', 'files', 'orders', 'reservations', 'subscriptions', 'tasks'
  ]
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE org_uuid IS NULL', t) INTO orphans;

    IF orphans > 0 THEN
      report := report || format('%s: %s row(s); ', t, orphans);
    END IF;
  END LOOP;

  IF report <> '' THEN
    RAISE EXCEPTION
      'Cannot make org_uuid NOT NULL — unscoped rows remain. %', report
      USING HINT =
        'These rows have no resolvable owner. Re-run migration 0014 if users were '
        'added since, or decide per table whether to delete or reassign them.';
  END IF;
END
$$;
--> statement-breakpoint

ALTER TABLE "apikeys" ALTER COLUMN "org_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "org_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "org_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "org_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "org_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "org_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "org_uuid" SET NOT NULL;
