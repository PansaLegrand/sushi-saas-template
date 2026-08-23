ALTER TABLE "affiliates" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "feedbacks" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_status_check" CHECK ("files"."status" in ('uploading', 'active', 'deleting', 'deleted', 'failed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_visibility_check" CHECK ("files"."visibility" in ('private', 'public', 'org')) NOT VALID;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_size_check" CHECK ("files"."size" >= 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "files" VALIDATE CONSTRAINT "files_status_check";--> statement-breakpoint
ALTER TABLE "files" VALIDATE CONSTRAINT "files_visibility_check";--> statement-breakpoint
ALTER TABLE "files" VALIDATE CONSTRAINT "files_size_check";
