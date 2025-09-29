-- Reservations feature tables

-- Services offered for reservation
CREATE TABLE IF NOT EXISTS "reservation_services" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "slug" varchar(255) NOT NULL UNIQUE,
  "title" varchar(255) NOT NULL,
  "description" text,
  "duration_min" integer NOT NULL DEFAULT 30,
  "price" integer NOT NULL DEFAULT 0,
  "currency" varchar(10) NOT NULL DEFAULT 'usd',
  "deposit_amount" integer NOT NULL DEFAULT 0,
  "require_deposit" boolean NOT NULL DEFAULT true,
  "cancellation_window_hours" integer NOT NULL DEFAULT 24,
  "buffer_before_min" integer NOT NULL DEFAULT 0,
  "buffer_after_min" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "reservation_services_active_idx"
  ON "reservation_services" ("active");

-- Reservations created by users
CREATE TABLE IF NOT EXISTS "reservations" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "reservation_no" varchar(255) NOT NULL UNIQUE,
  "user_uuid" varchar(255) NOT NULL,
  "service_id" integer NOT NULL,
  "start_at" timestamp with time zone NOT NULL,
  "end_at" timestamp with time zone NOT NULL,
  "timezone" varchar(64) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "hold_expires_at" timestamp with time zone,
  "order_no" varchar(255),
  "contact_email" varchar(255),
  "contact_phone" varchar(64),
  "notes" text,
  "policy_snapshot" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "reservations_service_time_idx"
  ON "reservations" ("service_id", "start_at");

CREATE INDEX IF NOT EXISTS "reservations_user_idx"
  ON "reservations" ("user_uuid");

