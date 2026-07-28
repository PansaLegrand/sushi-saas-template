ALTER TABLE "orders" ADD COLUMN "checkout_intent_id" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "checkout_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_price_id" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "checkout_locale" varchar(50);--> statement-breakpoint
CREATE UNIQUE INDEX "orders_org_checkout_intent_unique_idx" ON "orders" USING btree ("org_uuid","checkout_intent_id");