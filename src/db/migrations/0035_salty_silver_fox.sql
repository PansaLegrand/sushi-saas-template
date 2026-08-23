-- migration-safety: allow unbounded-update - matches FOREIGN KEY ON UPDATE clauses; this migration contains no data UPDATE statement.
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'pending_payment';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "request_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "job_uuid" varchar(255);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "output_file_uuid" varchar(255);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_credits_trans_no_credits_trans_no_fk" FOREIGN KEY ("credits_trans_no") REFERENCES "public"."credits"("trans_no") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_output_file_uuid_files_uuid_fk" FOREIGN KEY ("output_file_uuid") REFERENCES "public"."files"("uuid") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_job_uuid_jobs_uuid_fk" FOREIGN KEY ("job_uuid") REFERENCES "public"."jobs"("uuid") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE INDEX "tasks_job_idx" ON "tasks" USING btree ("job_uuid");--> statement-breakpoint
CREATE INDEX "tasks_output_file_idx" ON "tasks" USING btree ("output_file_uuid");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('pending', 'running', 'succeeded', 'failed', 'canceled')) NOT VALID;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_attempts_check" CHECK ("jobs"."attempts" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_max_attempts_check" CHECK ("jobs"."max_attempts" >= 1) NOT VALID;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" in ('pending_payment', 'queued', 'running', 'refunding', 'succeeded', 'failed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_credits_used_check" CHECK ("tasks"."credits_used" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_credits_trans_no_credits_trans_no_fk";--> statement-breakpoint
ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_output_file_uuid_files_uuid_fk";--> statement-breakpoint
ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_job_uuid_jobs_uuid_fk";--> statement-breakpoint
ALTER TABLE "jobs" VALIDATE CONSTRAINT "jobs_status_check";--> statement-breakpoint
ALTER TABLE "jobs" VALIDATE CONSTRAINT "jobs_attempts_check";--> statement-breakpoint
ALTER TABLE "jobs" VALIDATE CONSTRAINT "jobs_max_attempts_check";--> statement-breakpoint
ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_status_check";--> statement-breakpoint
ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_credits_used_check";
