CREATE TABLE "verification_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"category" varchar(32) NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"agent_id" uuid,
	"resource_id" uuid,
	"action" varchar(64),
	"expected" varchar(16) NOT NULL,
	"actual" varchar(32) NOT NULL,
	"result" varchar(16) NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"execution_reference" varchar(200),
	"limitation" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_checks_seq_unique" UNIQUE("run_id","seq"),
	CONSTRAINT "verification_checks_category_check" CHECK ("verification_checks"."category" in ('NEGATIVE_ACCESS_TEST','POSITIVE_ACCESS_TEST','PERMISSION_PERSISTENCE_TEST','PATH_BLOCK_TEST','RESOURCE_HEALTH_TEST','BYPASS_RESISTANCE_TEST')),
	CONSTRAINT "verification_checks_purpose_check" CHECK ("verification_checks"."purpose" in ('security','continuity')),
	CONSTRAINT "verification_checks_result_check" CHECK ("verification_checks"."result" in ('passed','failed','inconclusive'))
);
--> statement-breakpoint
CREATE TABLE "verification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"approval_id" uuid,
	"plan_reference_id" uuid NOT NULL,
	"plan_hash" varchar(64) NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"snapshot_hash" varchar(64) NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"retry_of" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"summary" jsonb,
	"result_hash" varchar(64),
	"incident_outcome" varchar(32),
	"incident_synced" boolean DEFAULT false NOT NULL,
	"idempotency_key" varchar(200),
	"requested_by" uuid NOT NULL,
	"requested_by_type" varchar(8) NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_runs_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "verification_runs_status_check" CHECK ("verification_runs"."status" in ('pending','running','passed','failed','partially_verified','inconclusive'))
);
--> statement-breakpoint
ALTER TABLE "verification_checks" ADD CONSTRAINT "verification_checks_run_fk" FOREIGN KEY ("run_id","organization_id") REFERENCES "public"."verification_runs"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_incident_fk" FOREIGN KEY ("incident_id","organization_id") REFERENCES "public"."incidents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_plan_fk" FOREIGN KEY ("plan_reference_id","organization_id") REFERENCES "public"."incident_analysis_references"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_approval_fk" FOREIGN KEY ("approval_id","organization_id") REFERENCES "public"."approval_requests"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "verification_runs_idem" ON "verification_runs" USING btree ("organization_id","idempotency_key") WHERE "verification_runs"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "verification_runs_one_active" ON "verification_runs" USING btree ("organization_id","incident_id") WHERE "verification_runs"."status" in ('pending','running');--> statement-breakpoint
CREATE INDEX "verification_runs_incident_idx" ON "verification_runs" USING btree ("organization_id","incident_id","created_at");