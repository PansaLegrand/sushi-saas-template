CREATE TABLE "files" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" varchar(255) NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"org_id" varchar(255) DEFAULT '' NOT NULL,
	"provider" varchar(32) DEFAULT 's3' NOT NULL,
	"bucket" varchar(255) NOT NULL,
	"key" varchar(1024) NOT NULL,
	"region" varchar(64),
	"endpoint" varchar(255),
	"version_id" varchar(255),
	"size" integer DEFAULT 0 NOT NULL,
	"content_type" varchar(255) DEFAULT 'application/octet-stream' NOT NULL,
	"etag" varchar(255),
	"checksum_sha256" varchar(128),
	"storage_class" varchar(64),
	"original_filename" varchar(255) DEFAULT '' NOT NULL,
	"extension" varchar(32) DEFAULT '' NOT NULL,
	"visibility" varchar(32) DEFAULT 'private' NOT NULL,
	"status" varchar(32) DEFAULT 'uploading' NOT NULL,
	"metadata_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "files_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE INDEX "files_user_idx" ON "files" USING btree ("user_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "files_bucket_key_unique_idx" ON "files" USING btree ("bucket","key");