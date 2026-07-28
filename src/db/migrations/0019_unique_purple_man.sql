-- The webhook receipt: Stripe ids denormalized out of the stored payload.
--
-- `payload` stays the record of truth. These columns exist because a `text`
-- column cannot answer "every event for this subscription" without a full scan
-- and a JSON parse per row — which is the question you have during an incident,
-- when the table is at its largest and you are in a hurry.
--
-- All nullable, nothing backfilled. Rows written before this migration keep
-- nulls; their payload is still there, so a one-off backfill stays possible and
-- guessing is not required in the meantime. No single event carries every id
-- either — a dispute has no invoice, a renewal has no request id — so a null here
-- is normal rather than a defect.
--
-- Three indexes, one per question actually asked: a customer's events, an
-- invoice's (what reconciliation walks), and a subscription's.
-- `stripe_object_id` is deliberately left unindexed — nothing queries by it, and
-- an unread index is write cost on every event Stripe delivers.
--
-- On a live database: the ADD COLUMNs are instant and rewrite nothing. The three
-- CREATE INDEX statements take a lock that blocks writes on
-- `stripe_webhook_events` while each builds, which means webhook deliveries 500
-- and Stripe retries them. On a small table that is milliseconds. If yours
-- already holds millions of events, create the three indexes by hand with
-- CONCURRENTLY first and this migration will skip them: drizzle wraps migrations
-- in a transaction, and CONCURRENTLY cannot run inside one.
ALTER TABLE "stripe_webhook_events" ADD COLUMN "stripe_object_id" varchar(255);--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "stripe_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "stripe_invoice_id" varchar(255);--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "stripe_subscription_id" varchar(255);--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "livemode" boolean;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "api_version" varchar(64);--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "request_id" varchar(255);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_customer_idx" ON "stripe_webhook_events" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_invoice_idx" ON "stripe_webhook_events" USING btree ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_subscription_idx" ON "stripe_webhook_events" USING btree ("stripe_subscription_id");
