ALTER TABLE "reservations" ADD COLUMN "blocked_start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "blocked_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "checkout_intent_id" varchar(255);--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "checkout_fingerprint" varchar(64);--> statement-breakpoint
UPDATE "reservations"
SET
  "blocked_start_at" = "start_at",
  "blocked_end_at" = "end_at"
WHERE "blocked_start_at" IS NULL OR "blocked_end_at" IS NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "set_reservation_blocked_range_defaults"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."blocked_start_at" := COALESCE(NEW."blocked_start_at", NEW."start_at");
  NEW."blocked_end_at" := COALESCE(NEW."blocked_end_at", NEW."end_at");
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "reservations_blocked_range_defaults"
BEFORE INSERT OR UPDATE OF "start_at", "end_at", "blocked_start_at", "blocked_end_at"
ON "reservations"
FOR EACH ROW
EXECUTE FUNCTION "set_reservation_blocked_range_defaults"();--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "blocked_start_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ALTER COLUMN "blocked_end_at" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_actor_checkout_intent_unique_idx" ON "reservations" USING btree ("org_uuid","user_uuid","checkout_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_order_no_unique_idx" ON "reservations" USING btree ("order_no") WHERE "reservations"."order_no" is not null;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_time_order_check" CHECK ("reservations"."end_at" > "reservations"."start_at");--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_blocked_time_order_check" CHECK ("reservations"."blocked_end_at" > "reservations"."blocked_start_at");--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_status_check" CHECK ("reservations"."status" in ('pending', 'confirmed', 'canceled', 'expired'));--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "btree_gist";--> statement-breakpoint
ALTER TABLE "reservations"
ADD CONSTRAINT "reservations_no_overlapping_active_slots"
EXCLUDE USING gist (
  "service_id" WITH =,
  tstzrange("blocked_start_at", "blocked_end_at", '[)') WITH &&
)
WHERE ("status" IN ('pending', 'confirmed'));
