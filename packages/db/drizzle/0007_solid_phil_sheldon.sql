ALTER TABLE "volunteer_teams" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "volunteer_teams" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "volunteer_teams" ADD COLUMN "elaka_text" text;--> statement-breakpoint
ALTER TABLE "volunteer_teams" ADD COLUMN "goli_text" text;--> statement-breakpoint
ALTER TABLE "volunteer_teams" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "volunteer_teams" ADD COLUMN "team_type" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "volunteer_teams" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;