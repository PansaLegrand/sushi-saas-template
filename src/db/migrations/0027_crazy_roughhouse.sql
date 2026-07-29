ALTER TABLE "orders" ADD COLUMN "stripe_payment_intent_id" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "stripe_charge_id" varchar(255);--> statement-breakpoint
CREATE INDEX "orders_stripe_payment_intent_idx" ON "orders" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "orders_stripe_charge_idx" ON "orders" USING btree ("stripe_charge_id");