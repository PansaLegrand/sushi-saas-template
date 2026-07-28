ALTER TABLE "stripe_webhook_events" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "resolved_by" varchar(255);--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "resolution_note" text;