-- Compatibility for databases that ran the original, uncommitted 0023/0024
-- cleanup while it still deleted replays without an archive. Fresh installs
-- already create this table in 0023, so every statement must be a safe no-op.
CREATE TABLE IF NOT EXISTS "affiliate_deduplication_archive" (
	"archive_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "affiliate_deduplication_archive_archive_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"original_affiliate_id" integer NOT NULL,
	"canonical_affiliate_id" integer NOT NULL,
	"reason" varchar(100) NOT NULL,
	"original_row_json" text NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_dedup_archive_original_reason_unique_idx" ON "affiliate_deduplication_archive" USING btree ("original_affiliate_id","reason");
