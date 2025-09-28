-- Add role column to users table for RBAC
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "role" varchar(50) NOT NULL DEFAULT 'user';

-- Optional: backfill existing NULLs to 'user' if the column existed without default
UPDATE "users" SET "role" = 'user' WHERE "role" IS NULL;

