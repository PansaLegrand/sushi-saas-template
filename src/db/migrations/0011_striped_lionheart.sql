CREATE TABLE "org_invitations" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(50),
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"uuid" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"logo" varchar(255),
	"metadata" text,
	"stripe_customer_id" varchar(255),
	"is_personal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_uuid_unique" UNIQUE("uuid"),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_organization_id" varchar(255);--> statement-breakpoint
CREATE INDEX "org_invitations_org_id_idx" ON "org_invitations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "org_invitations_email_idx" ON "org_invitations" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_org_user_unique_idx" ON "org_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "org_members_user_id_idx" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organizations_stripe_customer_idx" ON "organizations" USING btree ("stripe_customer_id");