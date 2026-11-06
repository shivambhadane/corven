CREATE TABLE "approval_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "approval_audit_logs_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"approval_id" uuid,
	"actor_id" uuid NOT NULL,
	"actor_type" varchar(8) NOT NULL,
	"action" varchar(48) NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"correlation_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"decision" varchar(8) NOT NULL,
	"decided_by" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"comment" text,
	"plan_hash" varchar(64) NOT NULL,
	"approval_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decisions_one_per_approver" UNIQUE("approval_id","decided_by"),
	CONSTRAINT "approval_decisions_decision_check" CHECK ("approval_decisions"."decision" in ('approve','reject'))
);
--> statement-breakpoint
CREATE TABLE "approval_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"required_approvals" integer NOT NULL,
	"elevated_required_approvals" integer NOT NULL,
	"separation_of_duties" boolean NOT NULL,
	"expiry_minutes" integer NOT NULL,
	"execution_window_minutes" integer NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_policies_org_unique" UNIQUE("organization_id"),
	CONSTRAINT "approval_policies_counts_check" CHECK ("approval_policies"."required_approvals" between 1 and 5 and "approval_policies"."elevated_required_approvals" between "approval_policies"."required_approvals" and 5),
	CONSTRAINT "approval_policies_minutes_check" CHECK ("approval_policies"."expiry_minutes" between 5 and 10080 and "approval_policies"."execution_window_minutes" between 5 and 1440)
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"plan_reference_id" uuid NOT NULL,
	"plan_version" integer NOT NULL,
	"plan_hash" varchar(64) NOT NULL,
	"snapshot_hash" varchar(64) NOT NULL,
	"result_hash" varchar(64) NOT NULL,
	"schema_version" integer NOT NULL,
	"approval_digest" varchar(64) NOT NULL,
	"risk" varchar(16) NOT NULL,
	"risk_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy" jsonb NOT NULL,
	"required_approvals" integer NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"comment" text,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"executable_until" timestamp with time zone,
	"closed_reason" text,
	"incident_synced" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "approval_requests_status_check" CHECK ("approval_requests"."status" in ('pending','approved','rejected','expired','cancelled','invalidated')),
	CONSTRAINT "approval_requests_risk_check" CHECK ("approval_requests"."risk" in ('standard','elevated')),
	CONSTRAINT "approval_requests_hash_check" CHECK ("approval_requests"."plan_hash" ~ '^[0-9a-f]{64}$' and "approval_requests"."approval_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "incident_analysis_references" ADD CONSTRAINT "incident_analysis_refs_id_org_unique" UNIQUE("id","organization_id");
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_fk" FOREIGN KEY ("approval_id","organization_id") REFERENCES "public"."approval_requests"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_incident_fk" FOREIGN KEY ("incident_id","organization_id") REFERENCES "public"."incidents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_plan_fk" FOREIGN KEY ("plan_reference_id","organization_id") REFERENCES "public"."incident_analysis_references"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_audit_logs_idx" ON "approval_audit_logs" USING btree ("organization_id","approval_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_one_pending" ON "approval_requests" USING btree ("organization_id","incident_id") WHERE "approval_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "approval_requests_org_idx" ON "approval_requests" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "approval_requests_lookup_idx" ON "approval_requests" USING btree ("organization_id","incident_id","plan_hash","status");--> statement-breakpoint