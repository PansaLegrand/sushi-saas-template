import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_marketing_email_templates_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__marketing_email_templates_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__marketing_email_templates_v_published_locale" AS ENUM('en', 'zh', 'es', 'fr', 'ja');
  CREATE TYPE "public"."enum_marketing_campaigns_blocks_heading_level" AS ENUM('1', '2', '3');
  CREATE TYPE "public"."enum_marketing_campaigns_blocks_heading_align" AS ENUM('left', 'center');
  CREATE TYPE "public"."enum_marketing_campaigns_blocks_text_align" AS ENUM('left', 'center');
  CREATE TYPE "public"."enum_marketing_campaigns_blocks_button_align" AS ENUM('left', 'center');
  CREATE TYPE "public"."enum_marketing_campaigns_blocks_spacer_size" AS ENUM('small', 'medium', 'large');
  CREATE TYPE "public"."enum_marketing_campaigns_locale" AS ENUM('en', 'zh', 'es', 'fr', 'ja');
  CREATE TYPE "public"."enum_marketing_campaigns_workflow_status" AS ENUM('draft', 'in-review', 'approved', 'archived');
  CREATE TYPE "public"."enum_marketing_campaigns_launch_status" AS ENUM('not-launched', 'scheduled', 'queued', 'failed');
  CREATE TYPE "public"."enum_marketing_campaigns_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__marketing_campaigns_v_blocks_heading_level" AS ENUM('1', '2', '3');
  CREATE TYPE "public"."enum__marketing_campaigns_v_blocks_heading_align" AS ENUM('left', 'center');
  CREATE TYPE "public"."enum__marketing_campaigns_v_blocks_text_align" AS ENUM('left', 'center');
  CREATE TYPE "public"."enum__marketing_campaigns_v_blocks_button_align" AS ENUM('left', 'center');
  CREATE TYPE "public"."enum__marketing_campaigns_v_blocks_spacer_size" AS ENUM('small', 'medium', 'large');
  CREATE TYPE "public"."enum__marketing_campaigns_v_version_locale" AS ENUM('en', 'zh', 'es', 'fr', 'ja');
  CREATE TYPE "public"."enum__marketing_campaigns_v_version_workflow_status" AS ENUM('draft', 'in-review', 'approved', 'archived');
  CREATE TYPE "public"."enum__marketing_campaigns_v_version_launch_status" AS ENUM('not-launched', 'scheduled', 'queued', 'failed');
  CREATE TYPE "public"."enum__marketing_campaigns_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__marketing_campaigns_v_published_locale" AS ENUM('en', 'zh', 'es', 'fr', 'ja');
  ALTER TYPE "public"."enum_service_accounts_scopes" ADD VALUE 'marketing:read' BEFORE 'jobs:read';
  ALTER TYPE "public"."enum_service_accounts_scopes" ADD VALUE 'marketing:draft:create' BEFORE 'jobs:read';
  ALTER TYPE "public"."enum_service_accounts_scopes" ADD VALUE 'marketing:draft:update' BEFORE 'jobs:read';
  ALTER TYPE "public"."enum_service_accounts_scopes" ADD VALUE 'marketing:test' BEFORE 'jobs:read';
  ALTER TYPE "public"."enum_service_accounts_scopes" ADD VALUE 'marketing:send' BEFORE 'jobs:read';
  CREATE TABLE "marketing_email_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar,
	"key" varchar,
	"logo_url" varchar,
	"accent_color" varchar DEFAULT '#15856f',
	"page_background_color" varchar DEFAULT '#f4f3ee',
	"content_background_color" varchar DEFAULT '#ffffff',
	"default_from_name" varchar,
	"default_reply_to" varchar,
	"company_address" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"_status" "enum_marketing_email_templates_status" DEFAULT 'draft'
  );

  CREATE TABLE "marketing_email_templates_locales" (
	"footer_text" varchar,
	"id" serial PRIMARY KEY NOT NULL,
	"_locale" "_locales" NOT NULL,
	"_parent_id" integer NOT NULL
  );

  CREATE TABLE "_marketing_email_templates_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"version_name" varchar,
	"version_key" varchar,
	"version_logo_url" varchar,
	"version_accent_color" varchar DEFAULT '#15856f',
	"version_page_background_color" varchar DEFAULT '#f4f3ee',
	"version_content_background_color" varchar DEFAULT '#ffffff',
	"version_default_from_name" varchar,
	"version_default_reply_to" varchar,
	"version_company_address" varchar,
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"version__status" "enum__marketing_email_templates_v_version_status" DEFAULT 'draft',
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"snapshot" boolean,
	"published_locale" "enum__marketing_email_templates_v_published_locale",
	"latest" boolean,
	"autosave" boolean
  );

  CREATE TABLE "_marketing_email_templates_v_locales" (
	"version_footer_text" varchar,
	"id" serial PRIMARY KEY NOT NULL,
	"_locale" "_locales" NOT NULL,
	"_parent_id" integer NOT NULL
  );

  CREATE TABLE "marketing_campaigns_blocks_heading" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"text" varchar,
	"level" "enum_marketing_campaigns_blocks_heading_level" DEFAULT '2',
	"align" "enum_marketing_campaigns_blocks_heading_align" DEFAULT 'left',
	"block_name" varchar
  );

  CREATE TABLE "marketing_campaigns_blocks_text" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"text" varchar,
	"align" "enum_marketing_campaigns_blocks_text_align" DEFAULT 'left',
	"block_name" varchar
  );

  CREATE TABLE "marketing_campaigns_blocks_image" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"url" varchar,
	"alt" varchar,
	"link_url" varchar,
	"block_name" varchar
  );

  CREATE TABLE "marketing_campaigns_blocks_button" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"label" varchar,
	"url" varchar,
	"align" "enum_marketing_campaigns_blocks_button_align" DEFAULT 'left',
	"block_name" varchar
  );

  CREATE TABLE "marketing_campaigns_blocks_divider" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"block_name" varchar
  );

  CREATE TABLE "marketing_campaigns_blocks_spacer" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"size" "enum_marketing_campaigns_blocks_spacer_size" DEFAULT 'medium',
	"block_name" varchar
  );

  CREATE TABLE "marketing_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"internal_name" varchar,
	"campaign_key" varchar,
	"locale" "enum_marketing_campaigns_locale" DEFAULT 'en',
	"audience_topic" varchar DEFAULT 'product-updates',
	"filter_audience_by_locale" boolean DEFAULT true,
	"template_id" integer,
	"subject" varchar,
	"preheader" varchar,
	"from_name" varchar,
	"reply_to" varchar,
	"workflow_status" "enum_marketing_campaigns_workflow_status" DEFAULT 'draft',
	"scheduled_at" timestamp(3) with time zone,
	"launch_status" "enum_marketing_campaigns_launch_status" DEFAULT 'not-launched',
	"launched_at" timestamp(3) with time zone,
	"recipient_count" numeric,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"_status" "enum_marketing_campaigns_status" DEFAULT 'draft'
  );

  CREATE TABLE "_marketing_campaigns_v_blocks_heading" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"text" varchar,
	"level" "enum__marketing_campaigns_v_blocks_heading_level" DEFAULT '2',
	"align" "enum__marketing_campaigns_v_blocks_heading_align" DEFAULT 'left',
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_marketing_campaigns_v_blocks_text" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"text" varchar,
	"align" "enum__marketing_campaigns_v_blocks_text_align" DEFAULT 'left',
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_marketing_campaigns_v_blocks_image" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"url" varchar,
	"alt" varchar,
	"link_url" varchar,
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_marketing_campaigns_v_blocks_button" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"label" varchar,
	"url" varchar,
	"align" "enum__marketing_campaigns_v_blocks_button_align" DEFAULT 'left',
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_marketing_campaigns_v_blocks_divider" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_marketing_campaigns_v_blocks_spacer" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"size" "enum__marketing_campaigns_v_blocks_spacer_size" DEFAULT 'medium',
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_marketing_campaigns_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"version_internal_name" varchar,
	"version_campaign_key" varchar,
	"version_locale" "enum__marketing_campaigns_v_version_locale" DEFAULT 'en',
	"version_audience_topic" varchar DEFAULT 'product-updates',
	"version_filter_audience_by_locale" boolean DEFAULT true,
	"version_template_id" integer,
	"version_subject" varchar,
	"version_preheader" varchar,
	"version_from_name" varchar,
	"version_reply_to" varchar,
	"version_workflow_status" "enum__marketing_campaigns_v_version_workflow_status" DEFAULT 'draft',
	"version_scheduled_at" timestamp(3) with time zone,
	"version_launch_status" "enum__marketing_campaigns_v_version_launch_status" DEFAULT 'not-launched',
	"version_launched_at" timestamp(3) with time zone,
	"version_recipient_count" numeric,
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"version__status" "enum__marketing_campaigns_v_version_status" DEFAULT 'draft',
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"snapshot" boolean,
	"published_locale" "enum__marketing_campaigns_v_published_locale",
	"latest" boolean,
	"autosave" boolean
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "marketing_email_templates_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "marketing_campaigns_id" integer;
  ALTER TABLE "marketing_email_templates_locales" ADD CONSTRAINT "marketing_email_templates_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."marketing_email_templates"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_marketing_email_templates_v" ADD CONSTRAINT "_marketing_email_templates_v_parent_id_marketing_email_templates_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."marketing_email_templates"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_marketing_email_templates_v_locales" ADD CONSTRAINT "_marketing_email_templates_v_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_marketing_email_templates_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "marketing_campaigns_blocks_heading" ADD CONSTRAINT "marketing_campaigns_blocks_heading_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "marketing_campaigns_blocks_text" ADD CONSTRAINT "marketing_campaigns_blocks_text_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "marketing_campaigns_blocks_image" ADD CONSTRAINT "marketing_campaigns_blocks_image_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "marketing_campaigns_blocks_button" ADD CONSTRAINT "marketing_campaigns_blocks_button_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "marketing_campaigns_blocks_divider" ADD CONSTRAINT "marketing_campaigns_blocks_divider_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "marketing_campaigns_blocks_spacer" ADD CONSTRAINT "marketing_campaigns_blocks_spacer_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_template_id_marketing_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."marketing_email_templates"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_marketing_campaigns_v_blocks_heading" ADD CONSTRAINT "_marketing_campaigns_v_blocks_heading_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_marketing_campaigns_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_marketing_campaigns_v_blocks_text" ADD CONSTRAINT "_marketing_campaigns_v_blocks_text_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_marketing_campaigns_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_marketing_campaigns_v_blocks_image" ADD CONSTRAINT "_marketing_campaigns_v_blocks_image_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_marketing_campaigns_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_marketing_campaigns_v_blocks_button" ADD CONSTRAINT "_marketing_campaigns_v_blocks_button_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_marketing_campaigns_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_marketing_campaigns_v_blocks_divider" ADD CONSTRAINT "_marketing_campaigns_v_blocks_divider_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_marketing_campaigns_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_marketing_campaigns_v_blocks_spacer" ADD CONSTRAINT "_marketing_campaigns_v_blocks_spacer_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_marketing_campaigns_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_marketing_campaigns_v" ADD CONSTRAINT "_marketing_campaigns_v_parent_id_marketing_campaigns_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_marketing_campaigns_v" ADD CONSTRAINT "_marketing_campaigns_v_version_template_id_marketing_email_templates_id_fk" FOREIGN KEY ("version_template_id") REFERENCES "public"."marketing_email_templates"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "marketing_email_templates_key_idx" ON "marketing_email_templates" USING btree ("key");
  CREATE INDEX "marketing_email_templates_updated_at_idx" ON "marketing_email_templates" USING btree ("updated_at");
  CREATE INDEX "marketing_email_templates_created_at_idx" ON "marketing_email_templates" USING btree ("created_at");
  CREATE INDEX "marketing_email_templates__status_idx" ON "marketing_email_templates" USING btree ("_status");
  CREATE UNIQUE INDEX "marketing_email_templates_locales_locale_parent_id_unique" ON "marketing_email_templates_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_marketing_email_templates_v_parent_idx" ON "_marketing_email_templates_v" USING btree ("parent_id");
  CREATE INDEX "_marketing_email_templates_v_version_version_key_idx" ON "_marketing_email_templates_v" USING btree ("version_key");
  CREATE INDEX "_marketing_email_templates_v_version_version_updated_at_idx" ON "_marketing_email_templates_v" USING btree ("version_updated_at");
  CREATE INDEX "_marketing_email_templates_v_version_version_created_at_idx" ON "_marketing_email_templates_v" USING btree ("version_created_at");
  CREATE INDEX "_marketing_email_templates_v_version_version__status_idx" ON "_marketing_email_templates_v" USING btree ("version__status");
  CREATE INDEX "_marketing_email_templates_v_created_at_idx" ON "_marketing_email_templates_v" USING btree ("created_at");
  CREATE INDEX "_marketing_email_templates_v_updated_at_idx" ON "_marketing_email_templates_v" USING btree ("updated_at");
  CREATE INDEX "_marketing_email_templates_v_snapshot_idx" ON "_marketing_email_templates_v" USING btree ("snapshot");
  CREATE INDEX "_marketing_email_templates_v_published_locale_idx" ON "_marketing_email_templates_v" USING btree ("published_locale");
  CREATE INDEX "_marketing_email_templates_v_latest_idx" ON "_marketing_email_templates_v" USING btree ("latest");
  CREATE INDEX "_marketing_email_templates_v_autosave_idx" ON "_marketing_email_templates_v" USING btree ("autosave");
  CREATE UNIQUE INDEX "_marketing_email_templates_v_locales_locale_parent_id_unique" ON "_marketing_email_templates_v_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "marketing_campaigns_blocks_heading_order_idx" ON "marketing_campaigns_blocks_heading" USING btree ("_order");
  CREATE INDEX "marketing_campaigns_blocks_heading_parent_id_idx" ON "marketing_campaigns_blocks_heading" USING btree ("_parent_id");
  CREATE INDEX "marketing_campaigns_blocks_heading_path_idx" ON "marketing_campaigns_blocks_heading" USING btree ("_path");
  CREATE INDEX "marketing_campaigns_blocks_text_order_idx" ON "marketing_campaigns_blocks_text" USING btree ("_order");
  CREATE INDEX "marketing_campaigns_blocks_text_parent_id_idx" ON "marketing_campaigns_blocks_text" USING btree ("_parent_id");
  CREATE INDEX "marketing_campaigns_blocks_text_path_idx" ON "marketing_campaigns_blocks_text" USING btree ("_path");
  CREATE INDEX "marketing_campaigns_blocks_image_order_idx" ON "marketing_campaigns_blocks_image" USING btree ("_order");
  CREATE INDEX "marketing_campaigns_blocks_image_parent_id_idx" ON "marketing_campaigns_blocks_image" USING btree ("_parent_id");
  CREATE INDEX "marketing_campaigns_blocks_image_path_idx" ON "marketing_campaigns_blocks_image" USING btree ("_path");
  CREATE INDEX "marketing_campaigns_blocks_button_order_idx" ON "marketing_campaigns_blocks_button" USING btree ("_order");
  CREATE INDEX "marketing_campaigns_blocks_button_parent_id_idx" ON "marketing_campaigns_blocks_button" USING btree ("_parent_id");
  CREATE INDEX "marketing_campaigns_blocks_button_path_idx" ON "marketing_campaigns_blocks_button" USING btree ("_path");
  CREATE INDEX "marketing_campaigns_blocks_divider_order_idx" ON "marketing_campaigns_blocks_divider" USING btree ("_order");
  CREATE INDEX "marketing_campaigns_blocks_divider_parent_id_idx" ON "marketing_campaigns_blocks_divider" USING btree ("_parent_id");
  CREATE INDEX "marketing_campaigns_blocks_divider_path_idx" ON "marketing_campaigns_blocks_divider" USING btree ("_path");
  CREATE INDEX "marketing_campaigns_blocks_spacer_order_idx" ON "marketing_campaigns_blocks_spacer" USING btree ("_order");
  CREATE INDEX "marketing_campaigns_blocks_spacer_parent_id_idx" ON "marketing_campaigns_blocks_spacer" USING btree ("_parent_id");
  CREATE INDEX "marketing_campaigns_blocks_spacer_path_idx" ON "marketing_campaigns_blocks_spacer" USING btree ("_path");
  CREATE UNIQUE INDEX "marketing_campaigns_campaign_key_idx" ON "marketing_campaigns" USING btree ("campaign_key");
  CREATE INDEX "marketing_campaigns_template_idx" ON "marketing_campaigns" USING btree ("template_id");
  CREATE INDEX "marketing_campaigns_updated_at_idx" ON "marketing_campaigns" USING btree ("updated_at");
  CREATE INDEX "marketing_campaigns_created_at_idx" ON "marketing_campaigns" USING btree ("created_at");
  CREATE INDEX "marketing_campaigns__status_idx" ON "marketing_campaigns" USING btree ("_status");
  CREATE INDEX "_marketing_campaigns_v_blocks_heading_order_idx" ON "_marketing_campaigns_v_blocks_heading" USING btree ("_order");
  CREATE INDEX "_marketing_campaigns_v_blocks_heading_parent_id_idx" ON "_marketing_campaigns_v_blocks_heading" USING btree ("_parent_id");
  CREATE INDEX "_marketing_campaigns_v_blocks_heading_path_idx" ON "_marketing_campaigns_v_blocks_heading" USING btree ("_path");
  CREATE INDEX "_marketing_campaigns_v_blocks_text_order_idx" ON "_marketing_campaigns_v_blocks_text" USING btree ("_order");
  CREATE INDEX "_marketing_campaigns_v_blocks_text_parent_id_idx" ON "_marketing_campaigns_v_blocks_text" USING btree ("_parent_id");
  CREATE INDEX "_marketing_campaigns_v_blocks_text_path_idx" ON "_marketing_campaigns_v_blocks_text" USING btree ("_path");
  CREATE INDEX "_marketing_campaigns_v_blocks_image_order_idx" ON "_marketing_campaigns_v_blocks_image" USING btree ("_order");
  CREATE INDEX "_marketing_campaigns_v_blocks_image_parent_id_idx" ON "_marketing_campaigns_v_blocks_image" USING btree ("_parent_id");
  CREATE INDEX "_marketing_campaigns_v_blocks_image_path_idx" ON "_marketing_campaigns_v_blocks_image" USING btree ("_path");
  CREATE INDEX "_marketing_campaigns_v_blocks_button_order_idx" ON "_marketing_campaigns_v_blocks_button" USING btree ("_order");
  CREATE INDEX "_marketing_campaigns_v_blocks_button_parent_id_idx" ON "_marketing_campaigns_v_blocks_button" USING btree ("_parent_id");
  CREATE INDEX "_marketing_campaigns_v_blocks_button_path_idx" ON "_marketing_campaigns_v_blocks_button" USING btree ("_path");
  CREATE INDEX "_marketing_campaigns_v_blocks_divider_order_idx" ON "_marketing_campaigns_v_blocks_divider" USING btree ("_order");
  CREATE INDEX "_marketing_campaigns_v_blocks_divider_parent_id_idx" ON "_marketing_campaigns_v_blocks_divider" USING btree ("_parent_id");
  CREATE INDEX "_marketing_campaigns_v_blocks_divider_path_idx" ON "_marketing_campaigns_v_blocks_divider" USING btree ("_path");
  CREATE INDEX "_marketing_campaigns_v_blocks_spacer_order_idx" ON "_marketing_campaigns_v_blocks_spacer" USING btree ("_order");
  CREATE INDEX "_marketing_campaigns_v_blocks_spacer_parent_id_idx" ON "_marketing_campaigns_v_blocks_spacer" USING btree ("_parent_id");
  CREATE INDEX "_marketing_campaigns_v_blocks_spacer_path_idx" ON "_marketing_campaigns_v_blocks_spacer" USING btree ("_path");
  CREATE INDEX "_marketing_campaigns_v_parent_idx" ON "_marketing_campaigns_v" USING btree ("parent_id");
  CREATE INDEX "_marketing_campaigns_v_version_version_campaign_key_idx" ON "_marketing_campaigns_v" USING btree ("version_campaign_key");
  CREATE INDEX "_marketing_campaigns_v_version_version_template_idx" ON "_marketing_campaigns_v" USING btree ("version_template_id");
  CREATE INDEX "_marketing_campaigns_v_version_version_updated_at_idx" ON "_marketing_campaigns_v" USING btree ("version_updated_at");
  CREATE INDEX "_marketing_campaigns_v_version_version_created_at_idx" ON "_marketing_campaigns_v" USING btree ("version_created_at");
  CREATE INDEX "_marketing_campaigns_v_version_version__status_idx" ON "_marketing_campaigns_v" USING btree ("version__status");
  CREATE INDEX "_marketing_campaigns_v_created_at_idx" ON "_marketing_campaigns_v" USING btree ("created_at");
  CREATE INDEX "_marketing_campaigns_v_updated_at_idx" ON "_marketing_campaigns_v" USING btree ("updated_at");
  CREATE INDEX "_marketing_campaigns_v_snapshot_idx" ON "_marketing_campaigns_v" USING btree ("snapshot");
  CREATE INDEX "_marketing_campaigns_v_published_locale_idx" ON "_marketing_campaigns_v" USING btree ("published_locale");
  CREATE INDEX "_marketing_campaigns_v_latest_idx" ON "_marketing_campaigns_v" USING btree ("latest");
  CREATE INDEX "_marketing_campaigns_v_autosave_idx" ON "_marketing_campaigns_v" USING btree ("autosave");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_marketing_email_templates_fk" FOREIGN KEY ("marketing_email_templates_id") REFERENCES "public"."marketing_email_templates"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_marketing_campaigns_fk" FOREIGN KEY ("marketing_campaigns_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_marketing_email_templates__idx" ON "payload_locked_documents_rels" USING btree ("marketing_email_templates_id");
  CREATE INDEX "payload_locked_documents_rels_marketing_campaigns_id_idx" ON "payload_locked_documents_rels" USING btree ("marketing_campaigns_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "marketing_email_templates" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "marketing_email_templates_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_marketing_email_templates_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_marketing_email_templates_v_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "marketing_campaigns_blocks_heading" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "marketing_campaigns_blocks_text" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "marketing_campaigns_blocks_image" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "marketing_campaigns_blocks_button" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "marketing_campaigns_blocks_divider" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "marketing_campaigns_blocks_spacer" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "marketing_campaigns" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_marketing_campaigns_v_blocks_heading" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_marketing_campaigns_v_blocks_text" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_marketing_campaigns_v_blocks_image" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_marketing_campaigns_v_blocks_button" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_marketing_campaigns_v_blocks_divider" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_marketing_campaigns_v_blocks_spacer" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_marketing_campaigns_v" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "marketing_email_templates" CASCADE;
  DROP TABLE "marketing_email_templates_locales" CASCADE;
  DROP TABLE "_marketing_email_templates_v" CASCADE;
  DROP TABLE "_marketing_email_templates_v_locales" CASCADE;
  DROP TABLE "marketing_campaigns_blocks_heading" CASCADE;
  DROP TABLE "marketing_campaigns_blocks_text" CASCADE;
  DROP TABLE "marketing_campaigns_blocks_image" CASCADE;
  DROP TABLE "marketing_campaigns_blocks_button" CASCADE;
  DROP TABLE "marketing_campaigns_blocks_divider" CASCADE;
  DROP TABLE "marketing_campaigns_blocks_spacer" CASCADE;
  DROP TABLE "marketing_campaigns" CASCADE;
  DROP TABLE "_marketing_campaigns_v_blocks_heading" CASCADE;
  DROP TABLE "_marketing_campaigns_v_blocks_text" CASCADE;
  DROP TABLE "_marketing_campaigns_v_blocks_image" CASCADE;
  DROP TABLE "_marketing_campaigns_v_blocks_button" CASCADE;
  DROP TABLE "_marketing_campaigns_v_blocks_divider" CASCADE;
  DROP TABLE "_marketing_campaigns_v_blocks_spacer" CASCADE;
  DROP TABLE "_marketing_campaigns_v" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_marketing_email_templates_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_marketing_campaigns_fk";

  ALTER TABLE "service_accounts_scopes" ALTER COLUMN "value" SET DATA TYPE text;
  DROP TYPE "public"."enum_service_accounts_scopes";
  CREATE TYPE "public"."enum_service_accounts_scopes" AS ENUM('content:read', 'content:draft:create', 'content:draft:update', 'content:submit', 'content:publish', 'jobs:read');
  ALTER TABLE "service_accounts_scopes" ALTER COLUMN "value" SET DATA TYPE "public"."enum_service_accounts_scopes" USING "value"::"public"."enum_service_accounts_scopes";
  DROP INDEX "payload_locked_documents_rels_marketing_email_templates__idx";
  DROP INDEX "payload_locked_documents_rels_marketing_campaigns_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "marketing_email_templates_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "marketing_campaigns_id";
  DROP TYPE "public"."enum_marketing_email_templates_status";
  DROP TYPE "public"."enum__marketing_email_templates_v_version_status";
  DROP TYPE "public"."enum__marketing_email_templates_v_published_locale";
  DROP TYPE "public"."enum_marketing_campaigns_blocks_heading_level";
  DROP TYPE "public"."enum_marketing_campaigns_blocks_heading_align";
  DROP TYPE "public"."enum_marketing_campaigns_blocks_text_align";
  DROP TYPE "public"."enum_marketing_campaigns_blocks_button_align";
  DROP TYPE "public"."enum_marketing_campaigns_blocks_spacer_size";
  DROP TYPE "public"."enum_marketing_campaigns_locale";
  DROP TYPE "public"."enum_marketing_campaigns_workflow_status";
  DROP TYPE "public"."enum_marketing_campaigns_launch_status";
  DROP TYPE "public"."enum_marketing_campaigns_status";
  DROP TYPE "public"."enum__marketing_campaigns_v_blocks_heading_level";
  DROP TYPE "public"."enum__marketing_campaigns_v_blocks_heading_align";
  DROP TYPE "public"."enum__marketing_campaigns_v_blocks_text_align";
  DROP TYPE "public"."enum__marketing_campaigns_v_blocks_button_align";
  DROP TYPE "public"."enum__marketing_campaigns_v_blocks_spacer_size";
  DROP TYPE "public"."enum__marketing_campaigns_v_version_locale";
  DROP TYPE "public"."enum__marketing_campaigns_v_version_workflow_status";
  DROP TYPE "public"."enum__marketing_campaigns_v_version_launch_status";
  DROP TYPE "public"."enum__marketing_campaigns_v_version_status";
  DROP TYPE "public"."enum__marketing_campaigns_v_published_locale";`)
}
