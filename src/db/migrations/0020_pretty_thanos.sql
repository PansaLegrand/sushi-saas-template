CREATE TABLE "email_blocklist" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "email_blocklist_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" varchar(255) NOT NULL,
	"scope" varchar(32) DEFAULT 'email' NOT NULL,
	"value" varchar(255) NOT NULL,
	"original_value" varchar(255) DEFAULT '' NOT NULL,
	"reason" varchar(500),
	"created_by" varchar(255) DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_blocklist_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ban_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_by" varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "email_blocklist_scope_value_unique_idx" ON "email_blocklist" USING btree ("scope","value");--> statement-breakpoint
CREATE INDEX "email_blocklist_created_idx" ON "email_blocklist" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_banned_at_idx" ON "users" USING btree ("banned_at") WHERE "users"."banned_at" is not null;