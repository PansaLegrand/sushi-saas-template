import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."_locales" AS ENUM('en', 'zh', 'es', 'fr', 'ja');
  CREATE TYPE "public"."enum_pages_blocks_hero_alignment" AS ENUM('left', 'center');
  CREATE TYPE "public"."enum_pages_blocks_callout_tone" AS ENUM('note', 'tip', 'warning');
  CREATE TYPE "public"."enum_pages_blocks_cta_style" AS ENUM('primary', 'secondary');
  CREATE TYPE "public"."enum_pages_blocks_tool_tool_key" AS ENUM('word-counter', 'percentage-calculator', 'keyword-density');
  CREATE TYPE "public"."enum_pages_blocks_tool_placement" AS ENUM('inline', 'wide', 'sticky-aside');
  CREATE TYPE "public"."enum_pages_blocks_tool_theme" AS ENUM('card', 'quiet', 'accent');
  CREATE TYPE "public"."enum_pages_template" AS ENUM('content', 'landing', 'content-with-tool', 'tool-first');
  CREATE TYPE "public"."enum_pages_workflow_status" AS ENUM('draft', 'in-review', 'approved', 'archived');
  CREATE TYPE "public"."enum_pages_seo_schema_type" AS ENUM('WebPage', 'Article', 'HowTo', 'FAQPage', 'SoftwareApplication');
  CREATE TYPE "public"."enum_pages_provenance_source" AS ENUM('human', 'api', 'batch-import', 'ai-workflow');
  CREATE TYPE "public"."enum_pages_seo_intent" AS ENUM('informational', 'commercial', 'transactional', 'navigational');
  CREATE TYPE "public"."enum_pages_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__pages_v_blocks_hero_alignment" AS ENUM('left', 'center');
  CREATE TYPE "public"."enum__pages_v_blocks_callout_tone" AS ENUM('note', 'tip', 'warning');
  CREATE TYPE "public"."enum__pages_v_blocks_cta_style" AS ENUM('primary', 'secondary');
  CREATE TYPE "public"."enum__pages_v_blocks_tool_tool_key" AS ENUM('word-counter', 'percentage-calculator', 'keyword-density');
  CREATE TYPE "public"."enum__pages_v_blocks_tool_placement" AS ENUM('inline', 'wide', 'sticky-aside');
  CREATE TYPE "public"."enum__pages_v_blocks_tool_theme" AS ENUM('card', 'quiet', 'accent');
  CREATE TYPE "public"."enum__pages_v_version_template" AS ENUM('content', 'landing', 'content-with-tool', 'tool-first');
  CREATE TYPE "public"."enum__pages_v_version_workflow_status" AS ENUM('draft', 'in-review', 'approved', 'archived');
  CREATE TYPE "public"."enum__pages_v_version_seo_schema_type" AS ENUM('WebPage', 'Article', 'HowTo', 'FAQPage', 'SoftwareApplication');
  CREATE TYPE "public"."enum__pages_v_version_provenance_source" AS ENUM('human', 'api', 'batch-import', 'ai-workflow');
  CREATE TYPE "public"."enum__pages_v_published_locale" AS ENUM('en', 'zh', 'es', 'fr', 'ja');
  CREATE TYPE "public"."enum__pages_v_version_seo_intent" AS ENUM('informational', 'commercial', 'transactional', 'navigational');
  CREATE TYPE "public"."enum__pages_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_posts_blocks_hero_alignment" AS ENUM('left', 'center');
  CREATE TYPE "public"."enum_posts_blocks_callout_tone" AS ENUM('note', 'tip', 'warning');
  CREATE TYPE "public"."enum_posts_blocks_cta_style" AS ENUM('primary', 'secondary');
  CREATE TYPE "public"."enum_posts_blocks_tool_tool_key" AS ENUM('word-counter', 'percentage-calculator', 'keyword-density');
  CREATE TYPE "public"."enum_posts_blocks_tool_placement" AS ENUM('inline', 'wide', 'sticky-aside');
  CREATE TYPE "public"."enum_posts_blocks_tool_theme" AS ENUM('card', 'quiet', 'accent');
  CREATE TYPE "public"."enum_posts_workflow_status" AS ENUM('draft', 'in-review', 'approved', 'archived');
  CREATE TYPE "public"."enum_posts_seo_schema_type" AS ENUM('WebPage', 'Article', 'HowTo', 'FAQPage', 'SoftwareApplication');
  CREATE TYPE "public"."enum_posts_provenance_source" AS ENUM('human', 'api', 'batch-import', 'ai-workflow');
  CREATE TYPE "public"."enum_posts_seo_intent" AS ENUM('informational', 'commercial', 'transactional', 'navigational');
  CREATE TYPE "public"."enum_posts_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__posts_v_blocks_hero_alignment" AS ENUM('left', 'center');
  CREATE TYPE "public"."enum__posts_v_blocks_callout_tone" AS ENUM('note', 'tip', 'warning');
  CREATE TYPE "public"."enum__posts_v_blocks_cta_style" AS ENUM('primary', 'secondary');
  CREATE TYPE "public"."enum__posts_v_blocks_tool_tool_key" AS ENUM('word-counter', 'percentage-calculator', 'keyword-density');
  CREATE TYPE "public"."enum__posts_v_blocks_tool_placement" AS ENUM('inline', 'wide', 'sticky-aside');
  CREATE TYPE "public"."enum__posts_v_blocks_tool_theme" AS ENUM('card', 'quiet', 'accent');
  CREATE TYPE "public"."enum__posts_v_version_workflow_status" AS ENUM('draft', 'in-review', 'approved', 'archived');
  CREATE TYPE "public"."enum__posts_v_version_seo_schema_type" AS ENUM('WebPage', 'Article', 'HowTo', 'FAQPage', 'SoftwareApplication');
  CREATE TYPE "public"."enum__posts_v_version_provenance_source" AS ENUM('human', 'api', 'batch-import', 'ai-workflow');
  CREATE TYPE "public"."enum__posts_v_published_locale" AS ENUM('en', 'zh', 'es', 'fr', 'ja');
  CREATE TYPE "public"."enum__posts_v_version_seo_intent" AS ENUM('informational', 'commercial', 'transactional', 'navigational');
  CREATE TYPE "public"."enum__posts_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_content_briefs_locale" AS ENUM('en', 'zh', 'es', 'fr', 'ja');
  CREATE TYPE "public"."enum_content_briefs_status" AS ENUM('idea', 'researched', 'ready', 'used', 'archived');
  CREATE TYPE "public"."enum_content_briefs_intent" AS ENUM('informational', 'commercial', 'transactional', 'navigational');
  CREATE TYPE "public"."enum_users_role" AS ENUM('writer', 'seo-manager', 'reviewer', 'publisher', 'admin');
  CREATE TYPE "public"."enum_service_accounts_scopes" AS ENUM('content:read', 'content:draft:create', 'content:draft:update', 'content:submit', 'content:publish', 'jobs:read');
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'importContent', 'schedulePublish');
  CREATE TYPE "public"."enum_payload_jobs_log_state" AS ENUM('failed', 'succeeded');
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'importContent', 'schedulePublish');
  CREATE TABLE "pages_blocks_hero" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"lede" varchar,
	"alignment" "enum_pages_blocks_hero_alignment" DEFAULT 'left',
	"block_name" varchar
  );

  CREATE TABLE "pages_blocks_rich_text" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"content" jsonb,
	"block_name" varchar
  );

  CREATE TABLE "pages_blocks_callout" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"heading" varchar,
	"body" varchar,
	"tone" "enum_pages_blocks_callout_tone" DEFAULT 'note',
	"block_name" varchar
  );

  CREATE TABLE "pages_blocks_faq_items" (
	"_order" integer NOT NULL,
	"_parent_id" varchar NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"question" varchar,
	"answer" varchar
  );

  CREATE TABLE "pages_blocks_faq" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"heading" varchar DEFAULT 'Frequently asked questions',
	"block_name" varchar
  );

  CREATE TABLE "pages_blocks_cta" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"heading" varchar,
	"body" varchar,
	"label" varchar,
	"href" varchar,
	"style" "enum_pages_blocks_cta_style" DEFAULT 'primary',
	"block_name" varchar
  );

  CREATE TABLE "pages_blocks_tool" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"tool_key" "enum_pages_blocks_tool_tool_key",
	"heading" varchar,
	"description" varchar,
	"placement" "enum_pages_blocks_tool_placement" DEFAULT 'inline',
	"theme" "enum_pages_blocks_tool_theme" DEFAULT 'card',
	"config_input_label" varchar,
	"config_default_keyword" varchar,
	"block_name" varchar
  );

  CREATE TABLE "pages_seo_secondary_queries" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"query" varchar
  );

  CREATE TABLE "pages_provenance_source_keywords" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"keyword" varchar
  );

  CREATE TABLE "pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar,
	"template" "enum_pages_template" DEFAULT 'content',
	"workflow_status" "enum_pages_workflow_status" DEFAULT 'draft',
	"published_at" timestamp(3) with time zone,
	"seo_canonical_path" varchar,
	"seo_schema_type" "enum_pages_seo_schema_type" DEFAULT 'WebPage',
	"seo_no_index" boolean DEFAULT false,
	"seo_open_graph_image_id" integer,
	"provenance_source" "enum_pages_provenance_source" DEFAULT 'human',
	"provenance_workflow_run_id" varchar,
	"provenance_model" varchar,
	"provenance_prompt_version" varchar,
	"provenance_generated_at" timestamp(3) with time zone,
	"provenance_last_human_edit_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "pages_locales" (
	"title" varchar,
	"summary" varchar,
	"seo_title" varchar,
	"seo_description" varchar,
	"seo_primary_query" varchar,
	"seo_intent" "enum_pages_seo_intent",
	"_status" "enum_pages_status" DEFAULT 'draft',
	"id" serial PRIMARY KEY NOT NULL,
	"_locale" "_locales" NOT NULL,
	"_parent_id" integer NOT NULL
  );

  CREATE TABLE "_pages_v_blocks_hero" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"lede" varchar,
	"alignment" "enum__pages_v_blocks_hero_alignment" DEFAULT 'left',
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_pages_v_blocks_rich_text" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"content" jsonb,
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_pages_v_blocks_callout" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"heading" varchar,
	"body" varchar,
	"tone" "enum__pages_v_blocks_callout_tone" DEFAULT 'note',
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_pages_v_blocks_faq_items" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"question" varchar,
	"answer" varchar,
	"_uuid" varchar
  );

  CREATE TABLE "_pages_v_blocks_faq" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"heading" varchar DEFAULT 'Frequently asked questions',
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_pages_v_blocks_cta" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"heading" varchar,
	"body" varchar,
	"label" varchar,
	"href" varchar,
	"style" "enum__pages_v_blocks_cta_style" DEFAULT 'primary',
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_pages_v_blocks_tool" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"tool_key" "enum__pages_v_blocks_tool_tool_key",
	"heading" varchar,
	"description" varchar,
	"placement" "enum__pages_v_blocks_tool_placement" DEFAULT 'inline',
	"theme" "enum__pages_v_blocks_tool_theme" DEFAULT 'card',
	"config_input_label" varchar,
	"config_default_keyword" varchar,
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_pages_v_version_seo_secondary_queries" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"query" varchar,
	"_uuid" varchar
  );

  CREATE TABLE "_pages_v_version_provenance_source_keywords" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"keyword" varchar,
	"_uuid" varchar
  );

  CREATE TABLE "_pages_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"version_slug" varchar,
	"version_template" "enum__pages_v_version_template" DEFAULT 'content',
	"version_workflow_status" "enum__pages_v_version_workflow_status" DEFAULT 'draft',
	"version_published_at" timestamp(3) with time zone,
	"version_seo_canonical_path" varchar,
	"version_seo_schema_type" "enum__pages_v_version_seo_schema_type" DEFAULT 'WebPage',
	"version_seo_no_index" boolean DEFAULT false,
	"version_seo_open_graph_image_id" integer,
	"version_provenance_source" "enum__pages_v_version_provenance_source" DEFAULT 'human',
	"version_provenance_workflow_run_id" varchar,
	"version_provenance_model" varchar,
	"version_provenance_prompt_version" varchar,
	"version_provenance_generated_at" timestamp(3) with time zone,
	"version_provenance_last_human_edit_at" timestamp(3) with time zone,
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"snapshot" boolean,
	"published_locale" "enum__pages_v_published_locale",
	"latest" boolean,
	"autosave" boolean
  );

  CREATE TABLE "_pages_v_locales" (
	"version_title" varchar,
	"version_summary" varchar,
	"version_seo_title" varchar,
	"version_seo_description" varchar,
	"version_seo_primary_query" varchar,
	"version_seo_intent" "enum__pages_v_version_seo_intent",
	"version__status" "enum__pages_v_version_status" DEFAULT 'draft',
	"id" serial PRIMARY KEY NOT NULL,
	"_locale" "_locales" NOT NULL,
	"_parent_id" integer NOT NULL
  );

  CREATE TABLE "posts_authors" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"name" varchar
  );

  CREATE TABLE "posts_blocks_hero" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"lede" varchar,
	"alignment" "enum_posts_blocks_hero_alignment" DEFAULT 'left',
	"block_name" varchar
  );

  CREATE TABLE "posts_blocks_rich_text" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"content" jsonb,
	"block_name" varchar
  );

  CREATE TABLE "posts_blocks_callout" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"heading" varchar,
	"body" varchar,
	"tone" "enum_posts_blocks_callout_tone" DEFAULT 'note',
	"block_name" varchar
  );

  CREATE TABLE "posts_blocks_faq_items" (
	"_order" integer NOT NULL,
	"_parent_id" varchar NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"question" varchar,
	"answer" varchar
  );

  CREATE TABLE "posts_blocks_faq" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"heading" varchar DEFAULT 'Frequently asked questions',
	"block_name" varchar
  );

  CREATE TABLE "posts_blocks_cta" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"heading" varchar,
	"body" varchar,
	"label" varchar,
	"href" varchar,
	"style" "enum_posts_blocks_cta_style" DEFAULT 'primary',
	"block_name" varchar
  );

  CREATE TABLE "posts_blocks_tool" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"tool_key" "enum_posts_blocks_tool_tool_key",
	"heading" varchar,
	"description" varchar,
	"placement" "enum_posts_blocks_tool_placement" DEFAULT 'inline',
	"theme" "enum_posts_blocks_tool_theme" DEFAULT 'card',
	"config_input_label" varchar,
	"config_default_keyword" varchar,
	"block_name" varchar
  );

  CREATE TABLE "posts_seo_secondary_queries" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"query" varchar
  );

  CREATE TABLE "posts_provenance_source_keywords" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"keyword" varchar
  );

  CREATE TABLE "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar,
	"workflow_status" "enum_posts_workflow_status" DEFAULT 'draft',
	"published_at" timestamp(3) with time zone,
	"seo_canonical_path" varchar,
	"seo_schema_type" "enum_posts_seo_schema_type" DEFAULT 'WebPage',
	"seo_no_index" boolean DEFAULT false,
	"seo_open_graph_image_id" integer,
	"provenance_source" "enum_posts_provenance_source" DEFAULT 'human',
	"provenance_workflow_run_id" varchar,
	"provenance_model" varchar,
	"provenance_prompt_version" varchar,
	"provenance_generated_at" timestamp(3) with time zone,
	"provenance_last_human_edit_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "posts_locales" (
	"title" varchar,
	"summary" varchar,
	"seo_title" varchar,
	"seo_description" varchar,
	"seo_primary_query" varchar,
	"seo_intent" "enum_posts_seo_intent",
	"_status" "enum_posts_status" DEFAULT 'draft',
	"id" serial PRIMARY KEY NOT NULL,
	"_locale" "_locales" NOT NULL,
	"_parent_id" integer NOT NULL
  );

  CREATE TABLE "_posts_v_version_authors" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar,
	"_uuid" varchar
  );

  CREATE TABLE "_posts_v_blocks_hero" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"eyebrow" varchar,
	"heading" varchar,
	"lede" varchar,
	"alignment" "enum__posts_v_blocks_hero_alignment" DEFAULT 'left',
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_posts_v_blocks_rich_text" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"content" jsonb,
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_posts_v_blocks_callout" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"heading" varchar,
	"body" varchar,
	"tone" "enum__posts_v_blocks_callout_tone" DEFAULT 'note',
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_posts_v_blocks_faq_items" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"question" varchar,
	"answer" varchar,
	"_uuid" varchar
  );

  CREATE TABLE "_posts_v_blocks_faq" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"heading" varchar DEFAULT 'Frequently asked questions',
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_posts_v_blocks_cta" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"heading" varchar,
	"body" varchar,
	"label" varchar,
	"href" varchar,
	"style" "enum__posts_v_blocks_cta_style" DEFAULT 'primary',
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_posts_v_blocks_tool" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_path" text NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"tool_key" "enum__posts_v_blocks_tool_tool_key",
	"heading" varchar,
	"description" varchar,
	"placement" "enum__posts_v_blocks_tool_placement" DEFAULT 'inline',
	"theme" "enum__posts_v_blocks_tool_theme" DEFAULT 'card',
	"config_input_label" varchar,
	"config_default_keyword" varchar,
	"_uuid" varchar,
	"block_name" varchar
  );

  CREATE TABLE "_posts_v_version_seo_secondary_queries" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"_locale" "_locales" NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"query" varchar,
	"_uuid" varchar
  );

  CREATE TABLE "_posts_v_version_provenance_source_keywords" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"keyword" varchar,
	"_uuid" varchar
  );

  CREATE TABLE "_posts_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"version_slug" varchar,
	"version_workflow_status" "enum__posts_v_version_workflow_status" DEFAULT 'draft',
	"version_published_at" timestamp(3) with time zone,
	"version_seo_canonical_path" varchar,
	"version_seo_schema_type" "enum__posts_v_version_seo_schema_type" DEFAULT 'WebPage',
	"version_seo_no_index" boolean DEFAULT false,
	"version_seo_open_graph_image_id" integer,
	"version_provenance_source" "enum__posts_v_version_provenance_source" DEFAULT 'human',
	"version_provenance_workflow_run_id" varchar,
	"version_provenance_model" varchar,
	"version_provenance_prompt_version" varchar,
	"version_provenance_generated_at" timestamp(3) with time zone,
	"version_provenance_last_human_edit_at" timestamp(3) with time zone,
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"snapshot" boolean,
	"published_locale" "enum__posts_v_published_locale",
	"latest" boolean,
	"autosave" boolean
  );

  CREATE TABLE "_posts_v_locales" (
	"version_title" varchar,
	"version_summary" varchar,
	"version_seo_title" varchar,
	"version_seo_description" varchar,
	"version_seo_primary_query" varchar,
	"version_seo_intent" "enum__posts_v_version_seo_intent",
	"version__status" "enum__posts_v_version_status" DEFAULT 'draft',
	"id" serial PRIMARY KEY NOT NULL,
	"_locale" "_locales" NOT NULL,
	"_parent_id" integer NOT NULL
  );

  CREATE TABLE "media" (
	"id" serial PRIMARY KEY NOT NULL,
	"is_public" boolean DEFAULT false,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"url" varchar,
	"thumbnail_u_r_l" varchar,
	"filename" varchar,
	"mime_type" varchar,
	"filesize" numeric,
	"width" numeric,
	"height" numeric,
	"focal_x" numeric,
	"focal_y" numeric,
	"sizes_thumbnail_url" varchar,
	"sizes_thumbnail_width" numeric,
	"sizes_thumbnail_height" numeric,
	"sizes_thumbnail_mime_type" varchar,
	"sizes_thumbnail_filesize" numeric,
	"sizes_thumbnail_filename" varchar,
	"sizes_social_url" varchar,
	"sizes_social_width" numeric,
	"sizes_social_height" numeric,
	"sizes_social_mime_type" varchar,
	"sizes_social_filesize" numeric,
	"sizes_social_filename" varchar
  );

  CREATE TABLE "media_locales" (
	"alt" varchar NOT NULL,
	"caption" varchar,
	"id" serial PRIMARY KEY NOT NULL,
	"_locale" "_locales" NOT NULL,
	"_parent_id" integer NOT NULL
  );

  CREATE TABLE "content_briefs_secondary_keywords" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"keyword" varchar NOT NULL
  );

  CREATE TABLE "content_briefs" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar NOT NULL,
	"locale" "enum_content_briefs_locale" NOT NULL,
	"status" "enum_content_briefs_status" DEFAULT 'idea' NOT NULL,
	"primary_keyword" varchar NOT NULL,
	"intent" "enum_content_briefs_intent",
	"audience" varchar,
	"outline" varchar NOT NULL,
	"internal_link_targets" varchar,
	"workflow_run_id" varchar,
	"source_data" jsonb,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "users_sessions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone,
	"expires_at" timestamp(3) with time zone NOT NULL
  );

  CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"role" "enum_users_role" DEFAULT 'writer' NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"email" varchar NOT NULL,
	"reset_password_token" varchar,
	"reset_password_expiration" timestamp(3) with time zone,
	"salt" varchar,
	"hash" varchar,
	"login_attempts" numeric DEFAULT 0,
	"lock_until" timestamp(3) with time zone
  );

  CREATE TABLE "service_accounts_scopes" (
	"order" integer NOT NULL,
	"parent_id" integer NOT NULL,
	"value" "enum_service_accounts_scopes",
	"id" serial PRIMARY KEY NOT NULL
  );

  CREATE TABLE "service_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"description" varchar,
	"expires_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"enable_a_p_i_key" boolean,
	"api_key" varchar,
	"api_key_index" varchar
  );

  CREATE TABLE "automation_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"idempotency_key" varchar NOT NULL,
	"request_hash" varchar NOT NULL,
	"operation" varchar NOT NULL,
	"identity" varchar NOT NULL,
	"status_code" numeric NOT NULL,
	"response" jsonb NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "payload_kv" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar NOT NULL,
	"data" jsonb NOT NULL
  );

  CREATE TABLE "payload_jobs_log" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"executed_at" timestamp(3) with time zone NOT NULL,
	"completed_at" timestamp(3) with time zone NOT NULL,
	"task_slug" "enum_payload_jobs_log_task_slug" NOT NULL,
	"task_i_d" varchar NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"state" "enum_payload_jobs_log_state" NOT NULL,
	"error" jsonb
  );

  CREATE TABLE "payload_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"input" jsonb,
	"completed_at" timestamp(3) with time zone,
	"total_tried" numeric DEFAULT 0,
	"has_error" boolean DEFAULT false,
	"error" jsonb,
	"task_slug" "enum_payload_jobs_task_slug",
	"queue" varchar DEFAULT 'default',
	"wait_until" timestamp(3) with time zone,
	"processing" boolean DEFAULT false,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "payload_locked_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"global_slug" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "payload_locked_documents_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"pages_id" integer,
	"posts_id" integer,
	"media_id" integer,
	"content_briefs_id" integer,
	"users_id" integer,
	"service_accounts_id" integer,
	"automation_requests_id" integer
  );

  CREATE TABLE "payload_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar,
	"value" jsonb,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "payload_preferences_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"users_id" integer,
	"service_accounts_id" integer
  );

  CREATE TABLE "payload_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar,
	"batch" numeric,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "pages_blocks_hero" ADD CONSTRAINT "pages_blocks_hero_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_rich_text" ADD CONSTRAINT "pages_blocks_rich_text_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_callout" ADD CONSTRAINT "pages_blocks_callout_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_faq_items" ADD CONSTRAINT "pages_blocks_faq_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages_blocks_faq"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_faq" ADD CONSTRAINT "pages_blocks_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_cta" ADD CONSTRAINT "pages_blocks_cta_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_blocks_tool" ADD CONSTRAINT "pages_blocks_tool_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_seo_secondary_queries" ADD CONSTRAINT "pages_seo_secondary_queries_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages_provenance_source_keywords" ADD CONSTRAINT "pages_provenance_source_keywords_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "pages" ADD CONSTRAINT "pages_seo_open_graph_image_id_media_id_fk" FOREIGN KEY ("seo_open_graph_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "pages_locales" ADD CONSTRAINT "pages_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_hero" ADD CONSTRAINT "_pages_v_blocks_hero_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_rich_text" ADD CONSTRAINT "_pages_v_blocks_rich_text_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_callout" ADD CONSTRAINT "_pages_v_blocks_callout_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_faq_items" ADD CONSTRAINT "_pages_v_blocks_faq_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v_blocks_faq"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_faq" ADD CONSTRAINT "_pages_v_blocks_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_cta" ADD CONSTRAINT "_pages_v_blocks_cta_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_blocks_tool" ADD CONSTRAINT "_pages_v_blocks_tool_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_seo_secondary_queries" ADD CONSTRAINT "_pages_v_version_seo_secondary_queries_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v_version_provenance_source_keywords" ADD CONSTRAINT "_pages_v_version_provenance_source_keywords_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_pages_v" ADD CONSTRAINT "_pages_v_parent_id_pages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pages"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v" ADD CONSTRAINT "_pages_v_version_seo_open_graph_image_id_media_id_fk" FOREIGN KEY ("version_seo_open_graph_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_pages_v_locales" ADD CONSTRAINT "_pages_v_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_pages_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_authors" ADD CONSTRAINT "posts_authors_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_blocks_hero" ADD CONSTRAINT "posts_blocks_hero_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_blocks_rich_text" ADD CONSTRAINT "posts_blocks_rich_text_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_blocks_callout" ADD CONSTRAINT "posts_blocks_callout_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_blocks_faq_items" ADD CONSTRAINT "posts_blocks_faq_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."posts_blocks_faq"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_blocks_faq" ADD CONSTRAINT "posts_blocks_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_blocks_cta" ADD CONSTRAINT "posts_blocks_cta_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_blocks_tool" ADD CONSTRAINT "posts_blocks_tool_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_seo_secondary_queries" ADD CONSTRAINT "posts_seo_secondary_queries_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_provenance_source_keywords" ADD CONSTRAINT "posts_provenance_source_keywords_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts" ADD CONSTRAINT "posts_seo_open_graph_image_id_media_id_fk" FOREIGN KEY ("seo_open_graph_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "posts_locales" ADD CONSTRAINT "posts_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_version_authors" ADD CONSTRAINT "_posts_v_version_authors_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_blocks_hero" ADD CONSTRAINT "_posts_v_blocks_hero_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_blocks_rich_text" ADD CONSTRAINT "_posts_v_blocks_rich_text_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_blocks_callout" ADD CONSTRAINT "_posts_v_blocks_callout_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_blocks_faq_items" ADD CONSTRAINT "_posts_v_blocks_faq_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_posts_v_blocks_faq"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_blocks_faq" ADD CONSTRAINT "_posts_v_blocks_faq_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_blocks_cta" ADD CONSTRAINT "_posts_v_blocks_cta_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_blocks_tool" ADD CONSTRAINT "_posts_v_blocks_tool_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_version_seo_secondary_queries" ADD CONSTRAINT "_posts_v_version_seo_secondary_queries_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_version_provenance_source_keywords" ADD CONSTRAINT "_posts_v_version_provenance_source_keywords_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v" ADD CONSTRAINT "_posts_v_parent_id_posts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_posts_v" ADD CONSTRAINT "_posts_v_version_seo_open_graph_image_id_media_id_fk" FOREIGN KEY ("version_seo_open_graph_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_posts_v_locales" ADD CONSTRAINT "_posts_v_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "media_locales" ADD CONSTRAINT "media_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "content_briefs_secondary_keywords" ADD CONSTRAINT "content_briefs_secondary_keywords_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."content_briefs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "service_accounts_scopes" ADD CONSTRAINT "service_accounts_scopes_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_jobs_log" ADD CONSTRAINT "payload_jobs_log_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."payload_jobs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_posts_fk" FOREIGN KEY ("posts_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_content_briefs_fk" FOREIGN KEY ("content_briefs_id") REFERENCES "public"."content_briefs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_service_accounts_fk" FOREIGN KEY ("service_accounts_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_automation_requests_fk" FOREIGN KEY ("automation_requests_id") REFERENCES "public"."automation_requests"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_service_accounts_fk" FOREIGN KEY ("service_accounts_id") REFERENCES "public"."service_accounts"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "pages_blocks_hero_order_idx" ON "pages_blocks_hero" USING btree ("_order");
  CREATE INDEX "pages_blocks_hero_parent_id_idx" ON "pages_blocks_hero" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_hero_path_idx" ON "pages_blocks_hero" USING btree ("_path");
  CREATE INDEX "pages_blocks_hero_locale_idx" ON "pages_blocks_hero" USING btree ("_locale");
  CREATE INDEX "pages_blocks_rich_text_order_idx" ON "pages_blocks_rich_text" USING btree ("_order");
  CREATE INDEX "pages_blocks_rich_text_parent_id_idx" ON "pages_blocks_rich_text" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_rich_text_path_idx" ON "pages_blocks_rich_text" USING btree ("_path");
  CREATE INDEX "pages_blocks_rich_text_locale_idx" ON "pages_blocks_rich_text" USING btree ("_locale");
  CREATE INDEX "pages_blocks_callout_order_idx" ON "pages_blocks_callout" USING btree ("_order");
  CREATE INDEX "pages_blocks_callout_parent_id_idx" ON "pages_blocks_callout" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_callout_path_idx" ON "pages_blocks_callout" USING btree ("_path");
  CREATE INDEX "pages_blocks_callout_locale_idx" ON "pages_blocks_callout" USING btree ("_locale");
  CREATE INDEX "pages_blocks_faq_items_order_idx" ON "pages_blocks_faq_items" USING btree ("_order");
  CREATE INDEX "pages_blocks_faq_items_parent_id_idx" ON "pages_blocks_faq_items" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_faq_items_locale_idx" ON "pages_blocks_faq_items" USING btree ("_locale");
  CREATE INDEX "pages_blocks_faq_order_idx" ON "pages_blocks_faq" USING btree ("_order");
  CREATE INDEX "pages_blocks_faq_parent_id_idx" ON "pages_blocks_faq" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_faq_path_idx" ON "pages_blocks_faq" USING btree ("_path");
  CREATE INDEX "pages_blocks_faq_locale_idx" ON "pages_blocks_faq" USING btree ("_locale");
  CREATE INDEX "pages_blocks_cta_order_idx" ON "pages_blocks_cta" USING btree ("_order");
  CREATE INDEX "pages_blocks_cta_parent_id_idx" ON "pages_blocks_cta" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_cta_path_idx" ON "pages_blocks_cta" USING btree ("_path");
  CREATE INDEX "pages_blocks_cta_locale_idx" ON "pages_blocks_cta" USING btree ("_locale");
  CREATE INDEX "pages_blocks_tool_order_idx" ON "pages_blocks_tool" USING btree ("_order");
  CREATE INDEX "pages_blocks_tool_parent_id_idx" ON "pages_blocks_tool" USING btree ("_parent_id");
  CREATE INDEX "pages_blocks_tool_path_idx" ON "pages_blocks_tool" USING btree ("_path");
  CREATE INDEX "pages_blocks_tool_locale_idx" ON "pages_blocks_tool" USING btree ("_locale");
  CREATE INDEX "pages_seo_secondary_queries_order_idx" ON "pages_seo_secondary_queries" USING btree ("_order");
  CREATE INDEX "pages_seo_secondary_queries_parent_id_idx" ON "pages_seo_secondary_queries" USING btree ("_parent_id");
  CREATE INDEX "pages_seo_secondary_queries_locale_idx" ON "pages_seo_secondary_queries" USING btree ("_locale");
  CREATE INDEX "pages_provenance_source_keywords_order_idx" ON "pages_provenance_source_keywords" USING btree ("_order");
  CREATE INDEX "pages_provenance_source_keywords_parent_id_idx" ON "pages_provenance_source_keywords" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "pages_slug_idx" ON "pages" USING btree ("slug");
  CREATE INDEX "pages_seo_seo_open_graph_image_idx" ON "pages" USING btree ("seo_open_graph_image_id");
  CREATE INDEX "pages_provenance_provenance_workflow_run_id_idx" ON "pages" USING btree ("provenance_workflow_run_id");
  CREATE INDEX "pages_updated_at_idx" ON "pages" USING btree ("updated_at");
  CREATE INDEX "pages_created_at_idx" ON "pages" USING btree ("created_at");
  CREATE INDEX "pages__status_idx" ON "pages_locales" USING btree ("_status","_locale");
  CREATE UNIQUE INDEX "pages_locales_locale_parent_id_unique" ON "pages_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_pages_v_blocks_hero_order_idx" ON "_pages_v_blocks_hero" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_hero_parent_id_idx" ON "_pages_v_blocks_hero" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_hero_path_idx" ON "_pages_v_blocks_hero" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_hero_locale_idx" ON "_pages_v_blocks_hero" USING btree ("_locale");
  CREATE INDEX "_pages_v_blocks_rich_text_order_idx" ON "_pages_v_blocks_rich_text" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_rich_text_parent_id_idx" ON "_pages_v_blocks_rich_text" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_rich_text_path_idx" ON "_pages_v_blocks_rich_text" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_rich_text_locale_idx" ON "_pages_v_blocks_rich_text" USING btree ("_locale");
  CREATE INDEX "_pages_v_blocks_callout_order_idx" ON "_pages_v_blocks_callout" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_callout_parent_id_idx" ON "_pages_v_blocks_callout" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_callout_path_idx" ON "_pages_v_blocks_callout" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_callout_locale_idx" ON "_pages_v_blocks_callout" USING btree ("_locale");
  CREATE INDEX "_pages_v_blocks_faq_items_order_idx" ON "_pages_v_blocks_faq_items" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_faq_items_parent_id_idx" ON "_pages_v_blocks_faq_items" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_faq_items_locale_idx" ON "_pages_v_blocks_faq_items" USING btree ("_locale");
  CREATE INDEX "_pages_v_blocks_faq_order_idx" ON "_pages_v_blocks_faq" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_faq_parent_id_idx" ON "_pages_v_blocks_faq" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_faq_path_idx" ON "_pages_v_blocks_faq" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_faq_locale_idx" ON "_pages_v_blocks_faq" USING btree ("_locale");
  CREATE INDEX "_pages_v_blocks_cta_order_idx" ON "_pages_v_blocks_cta" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_cta_parent_id_idx" ON "_pages_v_blocks_cta" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_cta_path_idx" ON "_pages_v_blocks_cta" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_cta_locale_idx" ON "_pages_v_blocks_cta" USING btree ("_locale");
  CREATE INDEX "_pages_v_blocks_tool_order_idx" ON "_pages_v_blocks_tool" USING btree ("_order");
  CREATE INDEX "_pages_v_blocks_tool_parent_id_idx" ON "_pages_v_blocks_tool" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_blocks_tool_path_idx" ON "_pages_v_blocks_tool" USING btree ("_path");
  CREATE INDEX "_pages_v_blocks_tool_locale_idx" ON "_pages_v_blocks_tool" USING btree ("_locale");
  CREATE INDEX "_pages_v_version_seo_secondary_queries_order_idx" ON "_pages_v_version_seo_secondary_queries" USING btree ("_order");
  CREATE INDEX "_pages_v_version_seo_secondary_queries_parent_id_idx" ON "_pages_v_version_seo_secondary_queries" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_version_seo_secondary_queries_locale_idx" ON "_pages_v_version_seo_secondary_queries" USING btree ("_locale");
  CREATE INDEX "_pages_v_version_provenance_source_keywords_order_idx" ON "_pages_v_version_provenance_source_keywords" USING btree ("_order");
  CREATE INDEX "_pages_v_version_provenance_source_keywords_parent_id_idx" ON "_pages_v_version_provenance_source_keywords" USING btree ("_parent_id");
  CREATE INDEX "_pages_v_parent_idx" ON "_pages_v" USING btree ("parent_id");
  CREATE INDEX "_pages_v_version_version_slug_idx" ON "_pages_v" USING btree ("version_slug");
  CREATE INDEX "_pages_v_version_seo_version_seo_open_graph_image_idx" ON "_pages_v" USING btree ("version_seo_open_graph_image_id");
  CREATE INDEX "_pages_v_version_provenance_version_provenance_workflow__idx" ON "_pages_v" USING btree ("version_provenance_workflow_run_id");
  CREATE INDEX "_pages_v_version_version_updated_at_idx" ON "_pages_v" USING btree ("version_updated_at");
  CREATE INDEX "_pages_v_version_version_created_at_idx" ON "_pages_v" USING btree ("version_created_at");
  CREATE INDEX "_pages_v_created_at_idx" ON "_pages_v" USING btree ("created_at");
  CREATE INDEX "_pages_v_updated_at_idx" ON "_pages_v" USING btree ("updated_at");
  CREATE INDEX "_pages_v_snapshot_idx" ON "_pages_v" USING btree ("snapshot");
  CREATE INDEX "_pages_v_published_locale_idx" ON "_pages_v" USING btree ("published_locale");
  CREATE INDEX "_pages_v_latest_idx" ON "_pages_v" USING btree ("latest");
  CREATE INDEX "_pages_v_autosave_idx" ON "_pages_v" USING btree ("autosave");
  CREATE INDEX "_pages_v_version_version__status_idx" ON "_pages_v_locales" USING btree ("version__status","_locale");
  CREATE UNIQUE INDEX "_pages_v_locales_locale_parent_id_unique" ON "_pages_v_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "posts_authors_order_idx" ON "posts_authors" USING btree ("_order");
  CREATE INDEX "posts_authors_parent_id_idx" ON "posts_authors" USING btree ("_parent_id");
  CREATE INDEX "posts_authors_locale_idx" ON "posts_authors" USING btree ("_locale");
  CREATE INDEX "posts_blocks_hero_order_idx" ON "posts_blocks_hero" USING btree ("_order");
  CREATE INDEX "posts_blocks_hero_parent_id_idx" ON "posts_blocks_hero" USING btree ("_parent_id");
  CREATE INDEX "posts_blocks_hero_path_idx" ON "posts_blocks_hero" USING btree ("_path");
  CREATE INDEX "posts_blocks_hero_locale_idx" ON "posts_blocks_hero" USING btree ("_locale");
  CREATE INDEX "posts_blocks_rich_text_order_idx" ON "posts_blocks_rich_text" USING btree ("_order");
  CREATE INDEX "posts_blocks_rich_text_parent_id_idx" ON "posts_blocks_rich_text" USING btree ("_parent_id");
  CREATE INDEX "posts_blocks_rich_text_path_idx" ON "posts_blocks_rich_text" USING btree ("_path");
  CREATE INDEX "posts_blocks_rich_text_locale_idx" ON "posts_blocks_rich_text" USING btree ("_locale");
  CREATE INDEX "posts_blocks_callout_order_idx" ON "posts_blocks_callout" USING btree ("_order");
  CREATE INDEX "posts_blocks_callout_parent_id_idx" ON "posts_blocks_callout" USING btree ("_parent_id");
  CREATE INDEX "posts_blocks_callout_path_idx" ON "posts_blocks_callout" USING btree ("_path");
  CREATE INDEX "posts_blocks_callout_locale_idx" ON "posts_blocks_callout" USING btree ("_locale");
  CREATE INDEX "posts_blocks_faq_items_order_idx" ON "posts_blocks_faq_items" USING btree ("_order");
  CREATE INDEX "posts_blocks_faq_items_parent_id_idx" ON "posts_blocks_faq_items" USING btree ("_parent_id");
  CREATE INDEX "posts_blocks_faq_items_locale_idx" ON "posts_blocks_faq_items" USING btree ("_locale");
  CREATE INDEX "posts_blocks_faq_order_idx" ON "posts_blocks_faq" USING btree ("_order");
  CREATE INDEX "posts_blocks_faq_parent_id_idx" ON "posts_blocks_faq" USING btree ("_parent_id");
  CREATE INDEX "posts_blocks_faq_path_idx" ON "posts_blocks_faq" USING btree ("_path");
  CREATE INDEX "posts_blocks_faq_locale_idx" ON "posts_blocks_faq" USING btree ("_locale");
  CREATE INDEX "posts_blocks_cta_order_idx" ON "posts_blocks_cta" USING btree ("_order");
  CREATE INDEX "posts_blocks_cta_parent_id_idx" ON "posts_blocks_cta" USING btree ("_parent_id");
  CREATE INDEX "posts_blocks_cta_path_idx" ON "posts_blocks_cta" USING btree ("_path");
  CREATE INDEX "posts_blocks_cta_locale_idx" ON "posts_blocks_cta" USING btree ("_locale");
  CREATE INDEX "posts_blocks_tool_order_idx" ON "posts_blocks_tool" USING btree ("_order");
  CREATE INDEX "posts_blocks_tool_parent_id_idx" ON "posts_blocks_tool" USING btree ("_parent_id");
  CREATE INDEX "posts_blocks_tool_path_idx" ON "posts_blocks_tool" USING btree ("_path");
  CREATE INDEX "posts_blocks_tool_locale_idx" ON "posts_blocks_tool" USING btree ("_locale");
  CREATE INDEX "posts_seo_secondary_queries_order_idx" ON "posts_seo_secondary_queries" USING btree ("_order");
  CREATE INDEX "posts_seo_secondary_queries_parent_id_idx" ON "posts_seo_secondary_queries" USING btree ("_parent_id");
  CREATE INDEX "posts_seo_secondary_queries_locale_idx" ON "posts_seo_secondary_queries" USING btree ("_locale");
  CREATE INDEX "posts_provenance_source_keywords_order_idx" ON "posts_provenance_source_keywords" USING btree ("_order");
  CREATE INDEX "posts_provenance_source_keywords_parent_id_idx" ON "posts_provenance_source_keywords" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "posts_slug_idx" ON "posts" USING btree ("slug");
  CREATE INDEX "posts_seo_seo_open_graph_image_idx" ON "posts" USING btree ("seo_open_graph_image_id");
  CREATE INDEX "posts_provenance_provenance_workflow_run_id_idx" ON "posts" USING btree ("provenance_workflow_run_id");
  CREATE INDEX "posts_updated_at_idx" ON "posts" USING btree ("updated_at");
  CREATE INDEX "posts_created_at_idx" ON "posts" USING btree ("created_at");
  CREATE INDEX "posts__status_idx" ON "posts_locales" USING btree ("_status","_locale");
  CREATE UNIQUE INDEX "posts_locales_locale_parent_id_unique" ON "posts_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "_posts_v_version_authors_order_idx" ON "_posts_v_version_authors" USING btree ("_order");
  CREATE INDEX "_posts_v_version_authors_parent_id_idx" ON "_posts_v_version_authors" USING btree ("_parent_id");
  CREATE INDEX "_posts_v_version_authors_locale_idx" ON "_posts_v_version_authors" USING btree ("_locale");
  CREATE INDEX "_posts_v_blocks_hero_order_idx" ON "_posts_v_blocks_hero" USING btree ("_order");
  CREATE INDEX "_posts_v_blocks_hero_parent_id_idx" ON "_posts_v_blocks_hero" USING btree ("_parent_id");
  CREATE INDEX "_posts_v_blocks_hero_path_idx" ON "_posts_v_blocks_hero" USING btree ("_path");
  CREATE INDEX "_posts_v_blocks_hero_locale_idx" ON "_posts_v_blocks_hero" USING btree ("_locale");
  CREATE INDEX "_posts_v_blocks_rich_text_order_idx" ON "_posts_v_blocks_rich_text" USING btree ("_order");
  CREATE INDEX "_posts_v_blocks_rich_text_parent_id_idx" ON "_posts_v_blocks_rich_text" USING btree ("_parent_id");
  CREATE INDEX "_posts_v_blocks_rich_text_path_idx" ON "_posts_v_blocks_rich_text" USING btree ("_path");
  CREATE INDEX "_posts_v_blocks_rich_text_locale_idx" ON "_posts_v_blocks_rich_text" USING btree ("_locale");
  CREATE INDEX "_posts_v_blocks_callout_order_idx" ON "_posts_v_blocks_callout" USING btree ("_order");
  CREATE INDEX "_posts_v_blocks_callout_parent_id_idx" ON "_posts_v_blocks_callout" USING btree ("_parent_id");
  CREATE INDEX "_posts_v_blocks_callout_path_idx" ON "_posts_v_blocks_callout" USING btree ("_path");
  CREATE INDEX "_posts_v_blocks_callout_locale_idx" ON "_posts_v_blocks_callout" USING btree ("_locale");
  CREATE INDEX "_posts_v_blocks_faq_items_order_idx" ON "_posts_v_blocks_faq_items" USING btree ("_order");
  CREATE INDEX "_posts_v_blocks_faq_items_parent_id_idx" ON "_posts_v_blocks_faq_items" USING btree ("_parent_id");
  CREATE INDEX "_posts_v_blocks_faq_items_locale_idx" ON "_posts_v_blocks_faq_items" USING btree ("_locale");
  CREATE INDEX "_posts_v_blocks_faq_order_idx" ON "_posts_v_blocks_faq" USING btree ("_order");
  CREATE INDEX "_posts_v_blocks_faq_parent_id_idx" ON "_posts_v_blocks_faq" USING btree ("_parent_id");
  CREATE INDEX "_posts_v_blocks_faq_path_idx" ON "_posts_v_blocks_faq" USING btree ("_path");
  CREATE INDEX "_posts_v_blocks_faq_locale_idx" ON "_posts_v_blocks_faq" USING btree ("_locale");
  CREATE INDEX "_posts_v_blocks_cta_order_idx" ON "_posts_v_blocks_cta" USING btree ("_order");
  CREATE INDEX "_posts_v_blocks_cta_parent_id_idx" ON "_posts_v_blocks_cta" USING btree ("_parent_id");
  CREATE INDEX "_posts_v_blocks_cta_path_idx" ON "_posts_v_blocks_cta" USING btree ("_path");
  CREATE INDEX "_posts_v_blocks_cta_locale_idx" ON "_posts_v_blocks_cta" USING btree ("_locale");
  CREATE INDEX "_posts_v_blocks_tool_order_idx" ON "_posts_v_blocks_tool" USING btree ("_order");
  CREATE INDEX "_posts_v_blocks_tool_parent_id_idx" ON "_posts_v_blocks_tool" USING btree ("_parent_id");
  CREATE INDEX "_posts_v_blocks_tool_path_idx" ON "_posts_v_blocks_tool" USING btree ("_path");
  CREATE INDEX "_posts_v_blocks_tool_locale_idx" ON "_posts_v_blocks_tool" USING btree ("_locale");
  CREATE INDEX "_posts_v_version_seo_secondary_queries_order_idx" ON "_posts_v_version_seo_secondary_queries" USING btree ("_order");
  CREATE INDEX "_posts_v_version_seo_secondary_queries_parent_id_idx" ON "_posts_v_version_seo_secondary_queries" USING btree ("_parent_id");
  CREATE INDEX "_posts_v_version_seo_secondary_queries_locale_idx" ON "_posts_v_version_seo_secondary_queries" USING btree ("_locale");
  CREATE INDEX "_posts_v_version_provenance_source_keywords_order_idx" ON "_posts_v_version_provenance_source_keywords" USING btree ("_order");
  CREATE INDEX "_posts_v_version_provenance_source_keywords_parent_id_idx" ON "_posts_v_version_provenance_source_keywords" USING btree ("_parent_id");
  CREATE INDEX "_posts_v_parent_idx" ON "_posts_v" USING btree ("parent_id");
  CREATE INDEX "_posts_v_version_version_slug_idx" ON "_posts_v" USING btree ("version_slug");
  CREATE INDEX "_posts_v_version_seo_version_seo_open_graph_image_idx" ON "_posts_v" USING btree ("version_seo_open_graph_image_id");
  CREATE INDEX "_posts_v_version_provenance_version_provenance_workflow__idx" ON "_posts_v" USING btree ("version_provenance_workflow_run_id");
  CREATE INDEX "_posts_v_version_version_updated_at_idx" ON "_posts_v" USING btree ("version_updated_at");
  CREATE INDEX "_posts_v_version_version_created_at_idx" ON "_posts_v" USING btree ("version_created_at");
  CREATE INDEX "_posts_v_created_at_idx" ON "_posts_v" USING btree ("created_at");
  CREATE INDEX "_posts_v_updated_at_idx" ON "_posts_v" USING btree ("updated_at");
  CREATE INDEX "_posts_v_snapshot_idx" ON "_posts_v" USING btree ("snapshot");
  CREATE INDEX "_posts_v_published_locale_idx" ON "_posts_v" USING btree ("published_locale");
  CREATE INDEX "_posts_v_latest_idx" ON "_posts_v" USING btree ("latest");
  CREATE INDEX "_posts_v_autosave_idx" ON "_posts_v" USING btree ("autosave");
  CREATE INDEX "_posts_v_version_version__status_idx" ON "_posts_v_locales" USING btree ("version__status","_locale");
  CREATE UNIQUE INDEX "_posts_v_locales_locale_parent_id_unique" ON "_posts_v_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "media_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "media" USING btree ("sizes_thumbnail_filename");
  CREATE INDEX "media_sizes_social_sizes_social_filename_idx" ON "media" USING btree ("sizes_social_filename");
  CREATE UNIQUE INDEX "media_locales_locale_parent_id_unique" ON "media_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "content_briefs_secondary_keywords_order_idx" ON "content_briefs_secondary_keywords" USING btree ("_order");
  CREATE INDEX "content_briefs_secondary_keywords_parent_id_idx" ON "content_briefs_secondary_keywords" USING btree ("_parent_id");
  CREATE INDEX "content_briefs_primary_keyword_idx" ON "content_briefs" USING btree ("primary_keyword");
  CREATE INDEX "content_briefs_workflow_run_id_idx" ON "content_briefs" USING btree ("workflow_run_id");
  CREATE INDEX "content_briefs_updated_at_idx" ON "content_briefs" USING btree ("updated_at");
  CREATE INDEX "content_briefs_created_at_idx" ON "content_briefs" USING btree ("created_at");
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE INDEX "service_accounts_scopes_order_idx" ON "service_accounts_scopes" USING btree ("order");
  CREATE INDEX "service_accounts_scopes_parent_idx" ON "service_accounts_scopes" USING btree ("parent_id");
  CREATE INDEX "service_accounts_updated_at_idx" ON "service_accounts" USING btree ("updated_at");
  CREATE INDEX "service_accounts_created_at_idx" ON "service_accounts" USING btree ("created_at");
  CREATE UNIQUE INDEX "automation_requests_idempotency_key_idx" ON "automation_requests" USING btree ("idempotency_key");
  CREATE INDEX "automation_requests_updated_at_idx" ON "automation_requests" USING btree ("updated_at");
  CREATE INDEX "automation_requests_created_at_idx" ON "automation_requests" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_jobs_log_order_idx" ON "payload_jobs_log" USING btree ("_order");
  CREATE INDEX "payload_jobs_log_parent_id_idx" ON "payload_jobs_log" USING btree ("_parent_id");
  CREATE INDEX "payload_jobs_completed_at_idx" ON "payload_jobs" USING btree ("completed_at");
  CREATE INDEX "payload_jobs_total_tried_idx" ON "payload_jobs" USING btree ("total_tried");
  CREATE INDEX "payload_jobs_has_error_idx" ON "payload_jobs" USING btree ("has_error");
  CREATE INDEX "payload_jobs_task_slug_idx" ON "payload_jobs" USING btree ("task_slug");
  CREATE INDEX "payload_jobs_queue_idx" ON "payload_jobs" USING btree ("queue");
  CREATE INDEX "payload_jobs_wait_until_idx" ON "payload_jobs" USING btree ("wait_until");
  CREATE INDEX "payload_jobs_processing_idx" ON "payload_jobs" USING btree ("processing");
  CREATE INDEX "payload_jobs_updated_at_idx" ON "payload_jobs" USING btree ("updated_at");
  CREATE INDEX "payload_jobs_created_at_idx" ON "payload_jobs" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_pages_id_idx" ON "payload_locked_documents_rels" USING btree ("pages_id");
  CREATE INDEX "payload_locked_documents_rels_posts_id_idx" ON "payload_locked_documents_rels" USING btree ("posts_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_content_briefs_id_idx" ON "payload_locked_documents_rels" USING btree ("content_briefs_id");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_service_accounts_id_idx" ON "payload_locked_documents_rels" USING btree ("service_accounts_id");
  CREATE INDEX "payload_locked_documents_rels_automation_requests_id_idx" ON "payload_locked_documents_rels" USING btree ("automation_requests_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_preferences_rels_service_accounts_id_idx" ON "payload_preferences_rels" USING btree ("service_accounts_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "pages_blocks_hero" CASCADE;
  DROP TABLE "pages_blocks_rich_text" CASCADE;
  DROP TABLE "pages_blocks_callout" CASCADE;
  DROP TABLE "pages_blocks_faq_items" CASCADE;
  DROP TABLE "pages_blocks_faq" CASCADE;
  DROP TABLE "pages_blocks_cta" CASCADE;
  DROP TABLE "pages_blocks_tool" CASCADE;
  DROP TABLE "pages_seo_secondary_queries" CASCADE;
  DROP TABLE "pages_provenance_source_keywords" CASCADE;
  DROP TABLE "pages" CASCADE;
  DROP TABLE "pages_locales" CASCADE;
  DROP TABLE "_pages_v_blocks_hero" CASCADE;
  DROP TABLE "_pages_v_blocks_rich_text" CASCADE;
  DROP TABLE "_pages_v_blocks_callout" CASCADE;
  DROP TABLE "_pages_v_blocks_faq_items" CASCADE;
  DROP TABLE "_pages_v_blocks_faq" CASCADE;
  DROP TABLE "_pages_v_blocks_cta" CASCADE;
  DROP TABLE "_pages_v_blocks_tool" CASCADE;
  DROP TABLE "_pages_v_version_seo_secondary_queries" CASCADE;
  DROP TABLE "_pages_v_version_provenance_source_keywords" CASCADE;
  DROP TABLE "_pages_v" CASCADE;
  DROP TABLE "_pages_v_locales" CASCADE;
  DROP TABLE "posts_authors" CASCADE;
  DROP TABLE "posts_blocks_hero" CASCADE;
  DROP TABLE "posts_blocks_rich_text" CASCADE;
  DROP TABLE "posts_blocks_callout" CASCADE;
  DROP TABLE "posts_blocks_faq_items" CASCADE;
  DROP TABLE "posts_blocks_faq" CASCADE;
  DROP TABLE "posts_blocks_cta" CASCADE;
  DROP TABLE "posts_blocks_tool" CASCADE;
  DROP TABLE "posts_seo_secondary_queries" CASCADE;
  DROP TABLE "posts_provenance_source_keywords" CASCADE;
  DROP TABLE "posts" CASCADE;
  DROP TABLE "posts_locales" CASCADE;
  DROP TABLE "_posts_v_version_authors" CASCADE;
  DROP TABLE "_posts_v_blocks_hero" CASCADE;
  DROP TABLE "_posts_v_blocks_rich_text" CASCADE;
  DROP TABLE "_posts_v_blocks_callout" CASCADE;
  DROP TABLE "_posts_v_blocks_faq_items" CASCADE;
  DROP TABLE "_posts_v_blocks_faq" CASCADE;
  DROP TABLE "_posts_v_blocks_cta" CASCADE;
  DROP TABLE "_posts_v_blocks_tool" CASCADE;
  DROP TABLE "_posts_v_version_seo_secondary_queries" CASCADE;
  DROP TABLE "_posts_v_version_provenance_source_keywords" CASCADE;
  DROP TABLE "_posts_v" CASCADE;
  DROP TABLE "_posts_v_locales" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "media_locales" CASCADE;
  DROP TABLE "content_briefs_secondary_keywords" CASCADE;
  DROP TABLE "content_briefs" CASCADE;
  DROP TABLE "users_sessions" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "service_accounts_scopes" CASCADE;
  DROP TABLE "service_accounts" CASCADE;
  DROP TABLE "automation_requests" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_jobs_log" CASCADE;
  DROP TABLE "payload_jobs" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TYPE "public"."_locales";
  DROP TYPE "public"."enum_pages_blocks_hero_alignment";
  DROP TYPE "public"."enum_pages_blocks_callout_tone";
  DROP TYPE "public"."enum_pages_blocks_cta_style";
  DROP TYPE "public"."enum_pages_blocks_tool_tool_key";
  DROP TYPE "public"."enum_pages_blocks_tool_placement";
  DROP TYPE "public"."enum_pages_blocks_tool_theme";
  DROP TYPE "public"."enum_pages_template";
  DROP TYPE "public"."enum_pages_workflow_status";
  DROP TYPE "public"."enum_pages_seo_schema_type";
  DROP TYPE "public"."enum_pages_provenance_source";
  DROP TYPE "public"."enum_pages_seo_intent";
  DROP TYPE "public"."enum_pages_status";
  DROP TYPE "public"."enum__pages_v_blocks_hero_alignment";
  DROP TYPE "public"."enum__pages_v_blocks_callout_tone";
  DROP TYPE "public"."enum__pages_v_blocks_cta_style";
  DROP TYPE "public"."enum__pages_v_blocks_tool_tool_key";
  DROP TYPE "public"."enum__pages_v_blocks_tool_placement";
  DROP TYPE "public"."enum__pages_v_blocks_tool_theme";
  DROP TYPE "public"."enum__pages_v_version_template";
  DROP TYPE "public"."enum__pages_v_version_workflow_status";
  DROP TYPE "public"."enum__pages_v_version_seo_schema_type";
  DROP TYPE "public"."enum__pages_v_version_provenance_source";
  DROP TYPE "public"."enum__pages_v_published_locale";
  DROP TYPE "public"."enum__pages_v_version_seo_intent";
  DROP TYPE "public"."enum__pages_v_version_status";
  DROP TYPE "public"."enum_posts_blocks_hero_alignment";
  DROP TYPE "public"."enum_posts_blocks_callout_tone";
  DROP TYPE "public"."enum_posts_blocks_cta_style";
  DROP TYPE "public"."enum_posts_blocks_tool_tool_key";
  DROP TYPE "public"."enum_posts_blocks_tool_placement";
  DROP TYPE "public"."enum_posts_blocks_tool_theme";
  DROP TYPE "public"."enum_posts_workflow_status";
  DROP TYPE "public"."enum_posts_seo_schema_type";
  DROP TYPE "public"."enum_posts_provenance_source";
  DROP TYPE "public"."enum_posts_seo_intent";
  DROP TYPE "public"."enum_posts_status";
  DROP TYPE "public"."enum__posts_v_blocks_hero_alignment";
  DROP TYPE "public"."enum__posts_v_blocks_callout_tone";
  DROP TYPE "public"."enum__posts_v_blocks_cta_style";
  DROP TYPE "public"."enum__posts_v_blocks_tool_tool_key";
  DROP TYPE "public"."enum__posts_v_blocks_tool_placement";
  DROP TYPE "public"."enum__posts_v_blocks_tool_theme";
  DROP TYPE "public"."enum__posts_v_version_workflow_status";
  DROP TYPE "public"."enum__posts_v_version_seo_schema_type";
  DROP TYPE "public"."enum__posts_v_version_provenance_source";
  DROP TYPE "public"."enum__posts_v_published_locale";
  DROP TYPE "public"."enum__posts_v_version_seo_intent";
  DROP TYPE "public"."enum__posts_v_version_status";
  DROP TYPE "public"."enum_content_briefs_locale";
  DROP TYPE "public"."enum_content_briefs_status";
  DROP TYPE "public"."enum_content_briefs_intent";
  DROP TYPE "public"."enum_users_role";
  DROP TYPE "public"."enum_service_accounts_scopes";
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  DROP TYPE "public"."enum_payload_jobs_log_state";
  DROP TYPE "public"."enum_payload_jobs_task_slug";`)
}
