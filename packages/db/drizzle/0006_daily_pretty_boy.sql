ALTER TABLE "reports" ADD COLUMN "community_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "community_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "accused_name" text;