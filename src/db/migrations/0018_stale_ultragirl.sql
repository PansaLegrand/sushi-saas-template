-- Audit columns for the credit ledger.
--
-- All three are nullable, and nothing is backfilled. That is the decision, not
-- an omission:
--
--   balance_after  A running total can only be reconstructed for history by
--                  replaying rows in an order the ledger does not record —
--                  `created_at` was nullable on this table until now and ties
--                  are common inside one webhook. A guessed running total is
--                  worse than none, because the reconciliation script that reads
--                  this column cannot tell a guess from a real inconsistency.
--   actor          Nobody recorded who caused the existing rows. `stripe:webhook`
--                  would be right for most and wrong for every admin grant.
--   metadata_json  Nothing to say about a row written before it existed.
--
-- So a null in any of these means "written before this migration", which is a
-- fact, and the script treats it as out of scope rather than as drift.
--
-- Safe on a live database: three ADD COLUMNs with no default and no NOT NULL
-- take a brief ACCESS EXCLUSIVE lock and rewrite nothing.
ALTER TABLE "credits" ADD COLUMN "balance_after" integer;--> statement-breakpoint
ALTER TABLE "credits" ADD COLUMN "actor" varchar(255);--> statement-breakpoint
ALTER TABLE "credits" ADD COLUMN "metadata_json" text;
