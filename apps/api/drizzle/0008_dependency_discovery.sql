CREATE TABLE "discovery_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"external_record_id" varchar(400) NOT NULL,
	"source_reference" varchar(400) NOT NULL,
	"raw_evidence" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"processing_status" varchar(24) DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"normalized" jsonb,
	"resolved" jsonb,
	"reconciliation_outcome" varchar(16),
	"dependency_id" uuid,
	"registry_outcome" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_observations_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "discovery_observations_status_check" CHECK ("discovery_observations"."processing_status" in ('pending','normalized','resolved','rejected','unresolved','pending_review','applied','review_rejected')),
	CONSTRAINT "discovery_observations_outcome_check" CHECK ("discovery_observations"."reconciliation_outcome" is null or "discovery_observations"."reconciliation_outcome" in ('new','unchanged','modified','missing','conflicting','stale','unresolved'))
);
--> statement-breakpoint
CREATE TABLE "discovery_reconciliation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"observation_id" uuid,
	"dependency_id" uuid,
	"outcome" varchar(16) NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_results_outcome_check" CHECK ("discovery_reconciliation_results"."outcome" in ('new','unchanged','modified','missing','conflicting','stale','unresolved'))
);
--> statement-breakpoint
CREATE TABLE "discovery_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"decision" varchar(16) NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"reason" text,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_reviews_decision_check" CHECK ("discovery_reviews"."decision" in ('approve','reject','defer'))
);
--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"records_collected" integer DEFAULT 0 NOT NULL,
	"observations_created" integer DEFAULT 0 NOT NULL,
	"relationships_created" integer DEFAULT 0 NOT NULL,
	"relationships_updated" integer DEFAULT 0 NOT NULL,
	"relationships_unchanged" integer DEFAULT 0 NOT NULL,
	"relationships_rejected" integer DEFAULT 0 NOT NULL,
	"unresolved_observations" integer DEFAULT 0 NOT NULL,
	"pending_review" integer DEFAULT 0 NOT NULL,
	"missing_relationships" integer DEFAULT 0 NOT NULL,
	"source_was_stale" boolean DEFAULT false NOT NULL,
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_runs_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "discovery_runs_status_check" CHECK ("discovery_runs"."status" in ('pending','running','completed','completed_with_errors','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "discovery_runtime_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"event_id" varchar(200) NOT NULL,
	"payload" jsonb NOT NULL,
	"received_by" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "discovery_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"name" varchar(120) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"freshness_window_hours" integer DEFAULT 168 NOT NULL,
	"last_successful_run_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_sources_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "discovery_sources_type_check" CHECK ("discovery_sources"."type" in ('agent_configuration','workflow_definition','runtime_gateway')),
	CONSTRAINT "discovery_sources_name_not_blank" CHECK (length(btrim("discovery_sources"."name")) > 0),
	CONSTRAINT "discovery_sources_freshness_check" CHECK ("discovery_sources"."freshness_window_hours" between 1 and 8760)
);
--> statement-breakpoint
ALTER TABLE "discovery_observations" ADD CONSTRAINT "discovery_observations_run_fk" FOREIGN KEY ("run_id","organization_id") REFERENCES "public"."discovery_runs"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_reconciliation_results" ADD CONSTRAINT "discovery_results_run_fk" FOREIGN KEY ("run_id","organization_id") REFERENCES "public"."discovery_runs"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_reviews" ADD CONSTRAINT "discovery_reviews_observation_fk" FOREIGN KEY ("observation_id","organization_id") REFERENCES "public"."discovery_observations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_source_fk" FOREIGN KEY ("source_id","organization_id") REFERENCES "public"."discovery_sources"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_runtime_events" ADD CONSTRAINT "discovery_events_source_fk" FOREIGN KEY ("source_id","organization_id") REFERENCES "public"."discovery_sources"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_observations_run_record_unique" ON "discovery_observations" USING btree ("run_id","external_record_id");--> statement-breakpoint
CREATE INDEX "discovery_observations_run_idx" ON "discovery_observations" USING btree ("organization_id","run_id","processing_status");--> statement-breakpoint
CREATE INDEX "discovery_results_run_idx" ON "discovery_reconciliation_results" USING btree ("organization_id","run_id","outcome");--> statement-breakpoint
CREATE INDEX "discovery_reviews_obs_idx" ON "discovery_reviews" USING btree ("organization_id","observation_id","reviewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_runs_one_active_per_source" ON "discovery_runs" USING btree ("source_id") WHERE "discovery_runs"."status" in ('pending','running');--> statement-breakpoint
CREATE INDEX "discovery_runs_org_idx" ON "discovery_runs" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_events_source_event_unique" ON "discovery_runtime_events" USING btree ("source_id","event_id");--> statement-breakpoint
CREATE INDEX "discovery_events_pending_idx" ON "discovery_runtime_events" USING btree ("source_id","consumed_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_sources_org_name_unique" ON "discovery_sources" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "discovery_sources_org_idx" ON "discovery_sources" USING btree ("organization_id","created_at","id");