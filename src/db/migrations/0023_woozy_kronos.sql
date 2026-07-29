-- Historical webhook races may already have produced more than one commission
-- row for a paid order. Preserve every replay as immutable migration evidence
-- before removing it from the active table. Empty order numbers are signup
-- attribution rows and intentionally remain non-unique here.
CREATE TABLE "affiliate_deduplication_archive" (
  "archive_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "original_affiliate_id" integer NOT NULL,
  "canonical_affiliate_id" integer NOT NULL,
  "reason" varchar(100) NOT NULL,
  "original_row_json" text NOT NULL,
  "archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_dedup_archive_original_reason_unique_idx"
  ON "affiliate_deduplication_archive" USING btree
  ("original_affiliate_id", "reason");
--> statement-breakpoint
-- Serialize the archive/delete/index sequence with affiliate writers. This
-- prevents a webhook insert from landing between cleanup and index creation.
LOCK TABLE "affiliates" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO "affiliate_deduplication_archive" (
  "original_affiliate_id",
  "canonical_affiliate_id",
  "reason",
  "original_row_json",
  "archived_at"
)
SELECT
  newer."id",
  canonical."id",
  'duplicate_paid_order_no',
  to_jsonb(newer)::text,
  now()
FROM "affiliates" AS newer
CROSS JOIN LATERAL (
  SELECT MIN(older."id") AS "id"
  FROM "affiliates" AS older
  WHERE older."paid_order_no" = newer."paid_order_no"
    AND older."id" < newer."id"
) AS canonical
WHERE newer."paid_order_no" <> ''
  AND canonical."id" IS NOT NULL
ON CONFLICT ("original_affiliate_id", "reason") DO NOTHING;
--> statement-breakpoint
DELETE FROM "affiliates" AS newer
USING "affiliates" AS older
WHERE newer."paid_order_no" <> ''
  AND newer."paid_order_no" = older."paid_order_no"
  AND newer."id" > older."id";

CREATE UNIQUE INDEX "affiliates_paid_order_unique_idx"
  ON "affiliates" USING btree ("paid_order_no")
  WHERE "affiliates"."paid_order_no" <> '';
