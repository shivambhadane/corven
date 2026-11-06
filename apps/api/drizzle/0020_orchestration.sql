CREATE TABLE "incident_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"step" varchar(24) DEFAULT 'analysis' NOT NULL,
	"outcome" varchar(40),
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"approval_requested" boolean DEFAULT false NOT NULL,
	"evidence_id" uuid,
	"verification_attempts" integer DEFAULT 0 NOT NULL,
	"started_by" uuid NOT NULL,
	"started_by_type" varchar(8) NOT NULL,
	"correlation_id" varchar(100),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "incident_workflows_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "incident_workflows_status_check" CHECK ("incident_workflows"."status" in ('running','waiting','completed','stopped','blocked','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "workflow_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"type" varchar(40) NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incident_workflows" ADD CONSTRAINT "incident_workflows_incident_fk" FOREIGN KEY ("incident_id","organization_id") REFERENCES "public"."incidents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_workflow_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "public"."incident_workflows"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "incident_workflows_one_per_incident" ON "incident_workflows" USING btree ("organization_id","incident_id");--> statement-breakpoint
CREATE INDEX "incident_workflows_due_idx" ON "incident_workflows" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "workflow_events_idx" ON "workflow_events" USING btree ("organization_id","workflow_id","seq");