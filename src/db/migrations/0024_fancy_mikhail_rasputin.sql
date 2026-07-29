-- Keep the first signup attribution row for each invited user. Archive every
-- replay before removing it from the active table. Paid commissions are
-- excluded and remain one-per-order under migration 0023.
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
  'duplicate_signup_attribution',
  to_jsonb(newer)::text,
  now()
FROM "affiliates" AS newer
CROSS JOIN LATERAL (
  SELECT MIN(older."id") AS "id"
  FROM "affiliates" AS older
  WHERE older."paid_order_no" = ''
    AND older."user_uuid" = newer."user_uuid"
    AND older."id" < newer."id"
) AS canonical
WHERE newer."paid_order_no" = ''
  AND canonical."id" IS NOT NULL
ON CONFLICT ("original_affiliate_id", "reason") DO NOTHING;
--> statement-breakpoint
DELETE FROM "affiliates" AS newer
USING "affiliates" AS older
WHERE newer."paid_order_no" = ''
  AND older."paid_order_no" = ''
  AND newer."user_uuid" = older."user_uuid"
  AND newer."id" > older."id";

CREATE UNIQUE INDEX "affiliates_signup_user_unique_idx"
  ON "affiliates" USING btree ("user_uuid")
  WHERE "affiliates"."paid_order_no" = '';
