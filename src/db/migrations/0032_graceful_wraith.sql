CREATE TABLE "marketing_provider_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "marketing_provider_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" varchar(255) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"provider_message_id" varchar(255),
	"delivery_uuid" varchar(255),
	"outcome" varchar(32) DEFAULT 'processed' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_provider_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "marketing_campaign_dispatches" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_email_deliveries" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_email_deliveries" ADD COLUMN "bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_email_deliveries" ADD COLUMN "complained_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_email_deliveries" ADD COLUMN "suppressed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_email_deliveries" ADD COLUMN "provider_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_subscriptions" ADD COLUMN "suppressed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_subscriptions" ADD COLUMN "suppression_reason" varchar(64);--> statement-breakpoint
CREATE INDEX "marketing_provider_events_message_idx" ON "marketing_provider_events" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "marketing_provider_events_delivery_idx" ON "marketing_provider_events" USING btree ("delivery_uuid");--> statement-breakpoint
CREATE INDEX "marketing_provider_events_occurred_idx" ON "marketing_provider_events" USING btree ("occurred_at");