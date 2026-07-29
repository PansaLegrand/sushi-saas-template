CREATE TABLE "privacy_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "privacy_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" varchar(255) NOT NULL,
	"request_type" varchar(32) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'scheduled' NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"erased_subject_uuid" varchar(255),
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"blockers_json" text,
	"external_state_json" text,
	"last_error" text,
	"export_bucket" varchar(255),
	"export_key" varchar(1024),
	"export_size" integer,
	"export_sha256" varchar(64),
	"export_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_uuid_unique" UNIQUE("uuid"),
	CONSTRAINT "privacy_requests_type_check" CHECK ("privacy_requests"."request_type" in ('export', 'erasure')),
	CONSTRAINT "privacy_requests_status_check" CHECK ("privacy_requests"."status" in ('scheduled', 'processing', 'blocked', 'completed', 'canceled', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "apikeys" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "posts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "apikeys" CASCADE;--> statement-breakpoint
DROP TABLE "posts" CASCADE;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "subject_user_uuid" varchar(255);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "subject_org_uuid" varchar(255);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "lifecycle_status" varchar(32) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lifecycle_status" varchar(32) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_requests_user_type_key_unique_idx" ON "privacy_requests" USING btree ("user_uuid","request_type","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_requests_active_erasure_unique_idx" ON "privacy_requests" USING btree ("user_uuid") WHERE "privacy_requests"."request_type" = 'erasure' and "privacy_requests"."status" in ('scheduled', 'processing', 'failed');--> statement-breakpoint
CREATE INDEX "privacy_requests_user_created_idx" ON "privacy_requests" USING btree ("user_uuid","created_at");--> statement-breakpoint
CREATE INDEX "privacy_requests_due_idx" ON "privacy_requests" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "jobs_subject_user_idx" ON "jobs" USING btree ("subject_user_uuid");--> statement-breakpoint
CREATE INDEX "jobs_subject_org_idx" ON "jobs" USING btree ("subject_org_uuid");