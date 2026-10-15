CREATE TABLE "missing_persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"age" integer,
	"gender" text,
	"photo_url" text,
	"last_seen_lat" double precision,
	"last_seen_lng" double precision,
	"last_seen_text" text,
	"last_seen_date" timestamp with time zone,
	"contact_phone" text NOT NULL,
	"status" text DEFAULT 'missing' NOT NULL,
	"reporter_id" uuid,
	"found_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "missing_persons" ADD CONSTRAINT "missing_persons_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;