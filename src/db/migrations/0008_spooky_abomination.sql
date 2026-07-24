CREATE TABLE "admin_audit_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" varchar(255) NOT NULL,
	"actor_uuid" varchar(255) NOT NULL,
	"actor_email" varchar(255) DEFAULT '' NOT NULL,
	"actor_role" varchar(50) DEFAULT '' NOT NULL,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(64) DEFAULT '' NOT NULL,
	"target_uuid" varchar(255) DEFAULT '' NOT NULL,
	"status" varchar(32) DEFAULT 'succeeded' NOT NULL,
	"note" text,
	"metadata_json" text,
	"error_message" text,
	"ip_address" varchar(255),
	"user_agent" varchar(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_audit_logs_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE INDEX "admin_audit_logs_actor_idx" ON "admin_audit_logs" USING btree ("actor_uuid");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_action_idx" ON "admin_audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_target_idx" ON "admin_audit_logs" USING btree ("target_type","target_uuid");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_created_idx" ON "admin_audit_logs" USING btree ("created_at");