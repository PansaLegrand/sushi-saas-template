CREATE TABLE "tasks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tasks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" varchar(255) NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"type" varchar(64) DEFAULT 'text_to_video' NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"credits_trans_no" varchar(255),
	"user_input" text,
	"output_url" varchar(1024),
	"output_json" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE INDEX "tasks_user_idx" ON "tasks" USING btree ("user_uuid");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_trans_idx" ON "tasks" USING btree ("credits_trans_no");