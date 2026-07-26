ALTER TABLE "apikeys" ADD COLUMN "org_uuid" varchar(255);--> statement-breakpoint
ALTER TABLE "credits" ADD COLUMN "org_uuid" varchar(255);--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "org_uuid" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "org_uuid" varchar(255);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "org_uuid" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "org_uuid" varchar(255);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "org_uuid" varchar(255);--> statement-breakpoint
CREATE INDEX "apikeys_org_idx" ON "apikeys" USING btree ("org_uuid");--> statement-breakpoint
CREATE INDEX "credits_org_idx" ON "credits" USING btree ("org_uuid");--> statement-breakpoint
CREATE INDEX "files_org_idx" ON "files" USING btree ("org_uuid");--> statement-breakpoint
CREATE INDEX "orders_org_idx" ON "orders" USING btree ("org_uuid");--> statement-breakpoint
CREATE INDEX "reservations_org_idx" ON "reservations" USING btree ("org_uuid");--> statement-breakpoint
CREATE INDEX "subscriptions_org_status_idx" ON "subscriptions" USING btree ("org_uuid","status");--> statement-breakpoint
CREATE INDEX "tasks_org_idx" ON "tasks" USING btree ("org_uuid");