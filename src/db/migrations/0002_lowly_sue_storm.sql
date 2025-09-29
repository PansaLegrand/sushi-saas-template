CREATE TABLE "reservation_services" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reservation_services_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"duration_min" integer DEFAULT 30 NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"currency" varchar(10) DEFAULT 'usd' NOT NULL,
	"deposit_amount" integer DEFAULT 0 NOT NULL,
	"require_deposit" boolean DEFAULT true NOT NULL,
	"cancellation_window_hours" integer DEFAULT 24 NOT NULL,
	"buffer_before_min" integer DEFAULT 0 NOT NULL,
	"buffer_after_min" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_services_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reservations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"reservation_no" varchar(255) NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"service_id" integer NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"order_no" varchar(255),
	"contact_email" varchar(255),
	"contact_phone" varchar(64),
	"notes" text,
	"policy_snapshot" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_reservation_no_unique" UNIQUE("reservation_no")
);
--> statement-breakpoint
CREATE INDEX "reservation_services_active_idx" ON "reservation_services" USING btree ("active");--> statement-breakpoint
CREATE INDEX "reservations_service_time_idx" ON "reservations" USING btree ("service_id","start_at");--> statement-breakpoint
CREATE INDEX "reservations_user_idx" ON "reservations" USING btree ("user_uuid");