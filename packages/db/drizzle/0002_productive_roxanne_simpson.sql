CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" text DEFAULT 'android' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "petition_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"petition_id" uuid NOT NULL,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "petition_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"petition_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "petitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"created_by" uuid,
	"threshold" integer DEFAULT 100 NOT NULL,
	"level" text DEFAULT 'thana' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "thana_id" uuid;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petition_events" ADD CONSTRAINT "petition_events_petition_id_petitions_id_fk" FOREIGN KEY ("petition_id") REFERENCES "public"."petitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petition_signatures" ADD CONSTRAINT "petition_signatures_petition_id_petitions_id_fk" FOREIGN KEY ("petition_id") REFERENCES "public"."petitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petition_signatures" ADD CONSTRAINT "petition_signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petitions" ADD CONSTRAINT "petitions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petitions" ADD CONSTRAINT "petitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "petition_signatures_petition_user_uniq" ON "petition_signatures" USING btree ("petition_id","user_id");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_thana_id_thanas_id_fk" FOREIGN KEY ("thana_id") REFERENCES "public"."thanas"("id") ON DELETE no action ON UPDATE no action;