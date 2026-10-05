import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "media" ADD COLUMN "prefix" varchar DEFAULT 'media';
  ALTER TABLE "media" ADD COLUMN "_objectkey" varchar;
  ALTER TABLE "users" ADD COLUMN "reset_password_requested_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "media" DROP COLUMN "prefix";
  ALTER TABLE "media" DROP COLUMN "_objectkey";
  ALTER TABLE "users" DROP COLUMN "reset_password_requested_at";`)
}
