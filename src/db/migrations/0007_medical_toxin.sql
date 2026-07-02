ALTER TABLE "tasks" ADD COLUMN "idempotency_key" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_idempotency_unique_idx" ON "tasks" USING btree ("user_uuid","type","idempotency_key");