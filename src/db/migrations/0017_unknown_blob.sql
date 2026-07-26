CREATE TABLE "two_factor" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apikeys" ALTER COLUMN "org_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "org_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "org_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "org_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "org_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "org_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "org_uuid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "two_factor_user_id_unique_idx" ON "two_factor" USING btree ("user_id");