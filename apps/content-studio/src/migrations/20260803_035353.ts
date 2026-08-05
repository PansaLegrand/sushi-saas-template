import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_marketing_campaigns_launch_status" ADD VALUE 'completed' BEFORE 'failed';
  ALTER TYPE "public"."enum_marketing_campaigns_launch_status" ADD VALUE 'canceled' BEFORE 'failed';
  ALTER TYPE "public"."enum__marketing_campaigns_v_version_launch_status" ADD VALUE 'completed' BEFORE 'failed';
  ALTER TYPE "public"."enum__marketing_campaigns_v_version_launch_status" ADD VALUE 'canceled' BEFORE 'failed';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   UPDATE "marketing_campaigns" SET "launch_status" = 'failed' WHERE "launch_status" IN ('completed', 'canceled');
  UPDATE "_marketing_campaigns_v" SET "version_launch_status" = 'failed' WHERE "version_launch_status" IN ('completed', 'canceled');
  ALTER TABLE "marketing_campaigns" ALTER COLUMN "launch_status" SET DATA TYPE text;
  ALTER TABLE "marketing_campaigns" ALTER COLUMN "launch_status" SET DEFAULT 'not-launched'::text;
  DROP TYPE "public"."enum_marketing_campaigns_launch_status";
  CREATE TYPE "public"."enum_marketing_campaigns_launch_status" AS ENUM('not-launched', 'scheduled', 'queued', 'failed');
  ALTER TABLE "marketing_campaigns" ALTER COLUMN "launch_status" SET DEFAULT 'not-launched'::"public"."enum_marketing_campaigns_launch_status";
  ALTER TABLE "marketing_campaigns" ALTER COLUMN "launch_status" SET DATA TYPE "public"."enum_marketing_campaigns_launch_status" USING "launch_status"::"public"."enum_marketing_campaigns_launch_status";
  ALTER TABLE "_marketing_campaigns_v" ALTER COLUMN "version_launch_status" SET DATA TYPE text;
  ALTER TABLE "_marketing_campaigns_v" ALTER COLUMN "version_launch_status" SET DEFAULT 'not-launched'::text;
  DROP TYPE "public"."enum__marketing_campaigns_v_version_launch_status";
  CREATE TYPE "public"."enum__marketing_campaigns_v_version_launch_status" AS ENUM('not-launched', 'scheduled', 'queued', 'failed');
  ALTER TABLE "_marketing_campaigns_v" ALTER COLUMN "version_launch_status" SET DEFAULT 'not-launched'::"public"."enum__marketing_campaigns_v_version_launch_status";
  ALTER TABLE "_marketing_campaigns_v" ALTER COLUMN "version_launch_status" SET DATA TYPE "public"."enum__marketing_campaigns_v_version_launch_status" USING "version_launch_status"::"public"."enum__marketing_campaigns_v_version_launch_status";`)
}
