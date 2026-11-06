CREATE TABLE "incident_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"relationship" varchar(16) NOT NULL,
	"suspected_compromised" boolean DEFAULT false NOT NULL,
	"impact" varchar(16) NOT NULL,
	"source" varchar(24) NOT NULL,
	"source_reference" varchar(500),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_agents_unique" UNIQUE("incident_id","agent_id","relationship"),
	CONSTRAINT "incident_agents_relationship_check" CHECK ("incident_agents"."relationship" in ('compromised','affected','dependent','observed','preserved')),
	CONSTRAINT "incident_agents_impact_check" CHECK ("incident_agents"."impact" in ('direct','indirect','none')),
	CONSTRAINT "incident_agents_source_check" CHECK ("incident_agents"."source" in ('manual','blast_radius','discovery','system'))
);
--> statement-breakpoint
CREATE TABLE "incident_analysis_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"version" integer NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"snapshot_hash" varchar(64) NOT NULL,
	"snapshot_built_at" timestamp with time zone NOT NULL,
	"snapshot_format_version" integer NOT NULL,
	"engine_version" varchar(32) NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_hash" varchar(64),
	"plan_hash" varchar(64),
	"plan_status" varchar(24),
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_analysis_refs_version_unique" UNIQUE("incident_id","kind","version"),
	CONSTRAINT "incident_analysis_refs_kind_check" CHECK ("incident_analysis_references"."kind" in ('graph_snapshot','blast_radius','containment_plan')),
	CONSTRAINT "incident_analysis_refs_hash_check" CHECK ("incident_analysis_references"."snapshot_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "incident_analysis_refs_plan_check" CHECK (("incident_analysis_references"."kind" = 'containment_plan') = ("incident_analysis_references"."plan_hash" is not null))
);
--> statement-breakpoint
CREATE TABLE "incident_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"note" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_type" varchar(8) NOT NULL,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"correlation_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "incident_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_type" varchar(8) NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" varchar(100),
	"idempotency_key" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_events_actor_type_check" CHECK ("incident_events"."actor_type" in ('human','system'))
);
--> statement-breakpoint
CREATE TABLE "incident_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_notes_content_check" CHECK (length(btrim("incident_notes"."content")) > 0 and length("incident_notes"."content") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "incident_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_type" varchar(32) NOT NULL,
	"relationship" varchar(16) NOT NULL,
	"impact_classification" varchar(24) NOT NULL,
	"source" varchar(24) NOT NULL,
	"source_reference" varchar(500),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_resources_unique" UNIQUE("incident_id","resource_id","relationship"),
	CONSTRAINT "incident_resources_relationship_check" CHECK ("incident_resources"."relationship" in ('exposed','affected','protected','observed')),
	CONSTRAINT "incident_resources_impact_check" CHECK ("incident_resources"."impact_classification" in ('exposed','potentially_affected','uncertain','healthy','unassessed')),
	CONSTRAINT "incident_resources_source_check" CHECK ("incident_resources"."source" in ('manual','blast_radius','discovery','system'))
);
--> statement-breakpoint
CREATE TABLE "incident_state_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"from_status" varchar(32),
	"to_status" varchar(32) NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_type" varchar(8) NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" varchar(100),
	"idempotency_key" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_state_history_to_check" CHECK (to_status in ('detected','investigating','containment_planned','awaiting_approval','approved','containing','verifying','contained','partially_contained','containment_failed','rejected','false_positive','resolved','closed')),
	CONSTRAINT "incident_state_history_actor_type_check" CHECK ("incident_state_history"."actor_type" in ('human','system'))
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"severity" varchar(16) NOT NULL,
	"status" varchar(32) DEFAULT 'detected' NOT NULL,
	"detection_source" varchar(32) NOT NULL,
	"detection_reference" varchar(200),
	"created_by" uuid NOT NULL,
	"created_by_type" varchar(8) NOT NULL,
	"assignee_id" uuid,
	"state_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_snapshot_ref_id" uuid,
	"current_blast_ref_id" uuid,
	"current_plan_ref_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "incidents_status_check" CHECK (status in ('detected','investigating','containment_planned','awaiting_approval','approved','containing','verifying','contained','partially_contained','containment_failed','rejected','false_positive','resolved','closed')),
	CONSTRAINT "incidents_severity_check" CHECK ("incidents"."severity" in ('critical','high','medium','low','informational')),
	CONSTRAINT "incidents_source_check" CHECK ("incidents"."detection_source" in ('manual','internal_event','runtime_signal','automated_detection')),
	CONSTRAINT "incidents_created_by_type_check" CHECK ("incidents"."created_by_type" in ('human','system')),
	CONSTRAINT "incidents_title_check" CHECK (length(btrim("incidents"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "incident_agents" ADD CONSTRAINT "incident_agents_incident_fk" FOREIGN KEY ("incident_id","organization_id") REFERENCES "public"."incidents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_agents" ADD CONSTRAINT "incident_agents_agent_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_analysis_references" ADD CONSTRAINT "incident_analysis_refs_incident_fk" FOREIGN KEY ("incident_id","organization_id") REFERENCES "public"."incidents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_analysis_references" ADD CONSTRAINT "incident_analysis_refs_snapshot_fk" FOREIGN KEY ("snapshot_id","organization_id") REFERENCES "public"."graph_snapshots"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_assignments" ADD CONSTRAINT "incident_assignments_incident_fk" FOREIGN KEY ("incident_id","organization_id") REFERENCES "public"."incidents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_audit_logs" ADD CONSTRAINT "incident_audit_logs_incident_fk" FOREIGN KEY ("incident_id","organization_id") REFERENCES "public"."incidents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_fk" FOREIGN KEY ("incident_id","organization_id") REFERENCES "public"."incidents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_notes" ADD CONSTRAINT "incident_notes_incident_fk" FOREIGN KEY ("incident_id","organization_id") REFERENCES "public"."incidents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_resources" ADD CONSTRAINT "incident_resources_incident_fk" FOREIGN KEY ("incident_id","organization_id") REFERENCES "public"."incidents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_resources" ADD CONSTRAINT "incident_resources_resource_fk" FOREIGN KEY ("resource_id","organization_id") REFERENCES "public"."resources"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_state_history" ADD CONSTRAINT "incident_state_history_incident_fk" FOREIGN KEY ("incident_id","organization_id") REFERENCES "public"."incidents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_agents_agent_idx" ON "incident_agents" USING btree ("organization_id","agent_id");--> statement-breakpoint
CREATE INDEX "incident_analysis_refs_idx" ON "incident_analysis_references" USING btree ("organization_id","incident_id","kind","version");--> statement-breakpoint
CREATE INDEX "incident_assignments_idx" ON "incident_assignments" USING btree ("organization_id","incident_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_audit_logs_idx" ON "incident_audit_logs" USING btree ("organization_id","incident_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_events_idx" ON "incident_events" USING btree ("organization_id","incident_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_events_idem_unique" ON "incident_events" USING btree ("incident_id","idempotency_key") WHERE "incident_events"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "incident_notes_idx" ON "incident_notes" USING btree ("organization_id","incident_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_state_history_idx" ON "incident_state_history" USING btree ("organization_id","incident_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_state_history_idem_unique" ON "incident_state_history" USING btree ("incident_id","idempotency_key") WHERE "incident_state_history"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_org_detection_unique" ON "incidents" USING btree ("organization_id","detection_source","detection_reference") WHERE "incidents"."detection_reference" is not null;--> statement-breakpoint
CREATE INDEX "incidents_org_created_idx" ON "incidents" USING btree ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "incidents_org_status_idx" ON "incidents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "incidents_org_severity_idx" ON "incidents" USING btree ("organization_id","severity");