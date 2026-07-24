CREATE TABLE "auth_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" varchar(255) NOT NULL,
	"user_uuid" varchar(255) DEFAULT '' NOT NULL,
	"user_id" varchar(255) DEFAULT '' NOT NULL,
	"email" varchar(255) DEFAULT '' NOT NULL,
	"event" varchar(32) NOT NULL,
	"provider" varchar(50) DEFAULT '' NOT NULL,
	"ip_address" varchar(255),
	"user_agent" varchar(1024),
	"metadata_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_events_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" varchar(255) NOT NULL,
	"type" varchar(64) NOT NULL,
	"payload_json" text,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"dedupe_key" varchar(255),
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "jobs_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_signin_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "auth_events_user_idx" ON "auth_events" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "auth_events_event_idx" ON "auth_events" USING btree ("event");--> statement-breakpoint
CREATE INDEX "auth_events_created_idx" ON "auth_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auth_events_user_event_idx" ON "auth_events" USING btree ("user_uuid","event");--> statement-breakpoint
CREATE INDEX "jobs_status_run_at_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_type_idx" ON "jobs" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key_unique_idx" ON "jobs" USING btree ("dedupe_key");