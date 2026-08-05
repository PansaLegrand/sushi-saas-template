CREATE TABLE "marketing_campaign_dispatches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "marketing_campaign_dispatches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" varchar(255) NOT NULL,
	"campaign_key" varchar(128) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"audience_topic" varchar(64) NOT NULL,
	"audience_locale" varchar(16),
	"status" varchar(32) DEFAULT 'queueing' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"queued_count" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_campaign_dispatches_uuid_unique" UNIQUE("uuid"),
	CONSTRAINT "marketing_campaign_dispatches_campaign_key_unique" UNIQUE("campaign_key")
);
--> statement-breakpoint
CREATE TABLE "marketing_email_deliveries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "marketing_email_deliveries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" varchar(255) NOT NULL,
	"campaign_key" varchar(128) NOT NULL,
	"subscription_uuid" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"provider_message_id" varchar(255),
	"sent_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_email_deliveries_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "marketing_subscriptions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "marketing_subscriptions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" varchar(255) NOT NULL,
	"email" varchar(320) NOT NULL,
	"email_key" varchar(320) NOT NULL,
	"topic" varchar(64) DEFAULT 'product-updates' NOT NULL,
	"locale" varchar(16) DEFAULT 'en' NOT NULL,
	"status" varchar(32) DEFAULT 'subscribed' NOT NULL,
	"consent_source" varchar(128) NOT NULL,
	"consent_version" varchar(64) NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_subscriptions_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE INDEX "marketing_campaign_dispatches_status_idx" ON "marketing_campaign_dispatches" USING btree ("status","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_email_deliveries_campaign_subscription_unique_idx" ON "marketing_email_deliveries" USING btree ("campaign_key","subscription_uuid");--> statement-breakpoint
CREATE INDEX "marketing_email_deliveries_campaign_status_idx" ON "marketing_email_deliveries" USING btree ("campaign_key","status");--> statement-breakpoint
CREATE INDEX "marketing_email_deliveries_subscription_idx" ON "marketing_email_deliveries" USING btree ("subscription_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_subscriptions_email_topic_unique_idx" ON "marketing_subscriptions" USING btree ("email_key","topic");--> statement-breakpoint
CREATE INDEX "marketing_subscriptions_audience_idx" ON "marketing_subscriptions" USING btree ("status","topic","locale");